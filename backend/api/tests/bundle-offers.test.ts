import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { BUNDLE_OFFERS_KEY, offerStatus } from '../src/modules/configuration/bundle-offers.js';
import { computeBundles, freeUnitsAfterRemoval, freeUnitsFor, type BundleLine } from '../src/modules/orders/bundle-pricing.js';
import { setBundleOffersReadyForTests } from '../src/modules/orders/bundle-offers.ready.js';
import { priceCart } from '../src/modules/orders/order.service.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Bundle offers (owner, 2026-10-25; migration 062): "buy 2 get 1 free" and "spend X, get a gift",
 * applied inside the real order pricing (priceCart), so the cart quote, the coupon preview and the
 * placed order agree. The checkout clock is pinned to 2026-10-06T06:30Z (tests/setup). The settings
 * rows this file changes (bundle_offers, wallet, points_program), its products, categories, coupons,
 * customers and audit entries are put back.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-BUN-');
const people = customerFixtures(app, { idPrefix: 'c0c00062', phoneBase: '+947096200', name: 'Bundle Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const KEYS = [BUNDLE_OFFERS_KEY, 'wallet', 'points_program'];
const stamp = Date.now();

type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row[] = [];
let testStart: Date;
let catParent = '';
let catChild = '';
let catOther = '';
const coupons: string[] = [];

// ---------------------------------------------------------------- helpers
const r2 = (n: number) => Math.round(n * 100) / 100;
const put = (offers: unknown, token = tokens.admin) => request(app).put('/api/v1/admin/settings/bundle-offers').set(auth(token)).send({ offers } as object);
const getOffers = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/bundle-offers').set(auth(token));
const setOffers = async (offers: unknown) => {
  const res = await put(offers);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
};
const clearOffers = () => pool.query('DELETE FROM system_configurations WHERE key = $1', [BUNDLE_OFFERS_KEY]);
const quote = (items: { product_id: string; quantity: number }[], token = tokens.customer) =>
  request(app).post('/api/v1/orders/bundle-quote').set(auth(token)).send({ items });
const quoteData = async (items: { product_id: string; quantity: number }[]) => {
  const res = await quote(items);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data;
};

/** A catalog product at a fixed selling price (cost 10), untracked unless stock is given. */
async function product(price: number, opts: { onHand?: number; tracked?: boolean; category?: string } = {}) {
  const p = await fx.product({ tracked: opts.tracked ?? opts.onHand !== undefined, onHand: opts.onHand ?? 0 });
  await pool.query(`UPDATE products SET purchase_cost = 10, pricing_mode = 'FIXED', fixed_selling_price = $2 WHERE id = $1`, [p.productId, price]);
  if (opts.category) await pool.query('UPDATE products SET category_id = $2 WHERE id = $1', [p.productId, opts.category]);
  return p;
}

const buyGet = (ids: string[] | null, extra: Record<string, unknown> = {}) => ({
  type: 'BUY_X_GET_Y',
  title: 'Buy 2 get 1 free',
  is_active: true,
  buy_qty: 2,
  get_qty: 1,
  product_ids: ids,
  category_id: null,
  ...extra,
});
const spendGift = (min: number, gift: string, extra: Record<string, unknown> = {}) => ({
  type: 'SPEND_GET_GIFT',
  title: `Spend ${min}, get a gift`,
  is_active: true,
  min_subtotal: min,
  gift_product_id: gift,
  gift_qty: 1,
  ...extra,
});

const place = async (items: { product_id: string; quantity: number }[], extra: object = {}, token = tokens.customer, addressId = fx.addressId) => {
  const res = await request(app).post('/api/v1/orders').set(auth(token)).send({ address_id: addressId, items, ...extra });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = res.body.data.order as Record<string, any>;
  fx.created.orders.push(order.id);
  return order;
};
const dbOrder = async (id: string) =>
  (
    await pool.query(
      `SELECT subtotal_amount::float AS subtotal, delivery_fee::float AS fee, discount_amount::float AS discount,
              wallet_amount_used::float AS wallet, total_amount::float AS total, order_status
         FROM orders WHERE id = $1`,
      [id]
    )
  ).rows[0] as { subtotal: number; fee: number; discount: number; wallet: number; total: number; order_status: string };
const dbItems = async (orderId: string) =>
  (
    await pool.query(
      `SELECT id, product_id, quantity, unit_selling_price::float AS price, subtotal::float AS subtotal, item_status,
              bundle_offer_id, bundle_kind, bundle_title, bundle_value::float AS value, bundle_rule
         FROM order_items WHERE order_id = $1 ORDER BY unit_selling_price DESC, bundle_kind NULLS FIRST, id`,
      [orderId]
    )
  ).rows as Array<{ id: string; product_id: string; quantity: number; price: number; subtotal: number; item_status: string; bundle_offer_id: string | null; bundle_kind: string | null; bundle_title: string | null; value: number | null; bundle_rule: any }>;

// ---------------------------------------------------------------- setup
beforeAll(async () => {
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query('SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = ANY($1)', [KEYS])).rows;
  await people.purge(10);
  await fx.setup();
  catParent = (await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`BUN Parent ${stamp}`, `bun-parent-${stamp}`])).rows[0].id;
  catChild = (await pool.query(`INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id`, [`BUN Child ${stamp}`, `bun-child-${stamp}`, catParent])).rows[0].id;
  catOther = (await pool.query(`INSERT INTO categories (name, slug) VALUES ($1, $2) RETURNING id`, [`BUN Other ${stamp}`, `bun-other-${stamp}`])).rows[0].id;
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
}, 60_000);

afterEach(async () => {
  setBundleOffersReadyForTests(null);
  await clearOffers();
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
  if (coupons.length) {
    await pool.query('DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = ANY($1))', [coupons]);
    await pool.query('DELETE FROM coupons WHERE code = ANY($1)', [coupons]);
  }
  await pool.query('DELETE FROM categories WHERE id = ANY($1::uuid[])', [[catChild, catParent, catOther].filter(Boolean)]);
  await pool.query(`DELETE FROM audit_logs WHERE action = 'BUNDLE_OFFERS_UPDATED' AND created_at >= $1`, [testStart]);
  await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'SYSTEM_CONFIGURATION' AND created_at >= $1 AND action IN ('WALLET_SETTINGS_UPDATED', 'POINTS_SETTINGS_UPDATED')`, [testStart]);
  await pool.query('DELETE FROM system_configurations WHERE key = ANY($1)', [KEYS]);
  for (const r of saved) {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ($1, $2::jsonb, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`,
      [r.key, JSON.stringify(r.value), r.description, r.created_at, r.updated_at]
    );
  }
});

// ============================================================================
describe('The rules (pure)', () => {
  const line = (index: number, price: number, quantity: number, product = `p${index}`, cat = 'c1', parent: string | null = null): BundleLine => ({
    index,
    product_id: product,
    category_id: cat,
    parent_category_id: parent,
    name: product,
    unit_price: price,
    quantity,
  });
  const offer = (over: Record<string, unknown> = {}) =>
    ({ id: 'o1', type: 'BUY_X_GET_Y', title: 'Buy 2 get 1', is_active: true, starts_at: null, ends_at: null, buy_qty: 2, get_qty: 1, product_ids: ['p0'], category_id: null, ...over }) as any;

  it('get_qty free per full group of buy_qty + get_qty', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map((n) => freeUnitsFor(n, { buy_qty: 2, get_qty: 1 }))).toEqual([0, 0, 1, 1, 1, 2, 3]);
    expect(freeUnitsFor(5, { buy_qty: 1, get_qty: 1 })).toBe(2);
    expect(freeUnitsFor(7, { buy_qty: 3, get_qty: 2 })).toBe(2);
  });

  it('the cheapest units are free, never more than were bought, ties go to the earlier line', () => {
    const o = computeBundles([line(0, 100, 2, 'p0'), line(1, 30, 1, 'p1')], 230, [offer({ product_ids: ['p0', 'p1'] })], new Map());
    expect(o.free).toHaveLength(1);
    expect(o.free[0]).toMatchObject({ line_index: 1, quantity: 1, value: 30 });
    expect(o.savings).toBe(30);
    const tie = computeBundles([line(0, 50, 2, 'p0'), line(1, 50, 2, 'p1')], 200, [offer({ product_ids: ['p0', 'p1'] })], new Map());
    expect(tie.free).toHaveLength(1);
    expect(tie.free[0].line_index).toBe(0);
  });

  it('a unit freed by an earlier offer is never freed again', () => {
    const first = offer({ id: 'a' });
    const second = offer({ id: 'b', buy_qty: 1, get_qty: 1 });
    const o = computeBundles([line(0, 100, 6, 'p0')], 600, [first, second], new Map());
    const freeA = o.free.filter((f) => f.offer.id === 'a').reduce((n, f) => n + f.quantity, 0);
    const freeB = o.free.filter((f) => f.offer.id === 'b').reduce((n, f) => n + f.quantity, 0);
    expect(freeA).toBe(2); // 6 units: 2 groups of 3
    expect(freeB).toBe(2); // 4 units left: 2 groups of 2
    expect(freeA + freeB).toBeLessThanOrEqual(6);
  });

  it('removal: the free units never exceed what the remaining paid units earn', () => {
    expect(freeUnitsAfterRemoval(2, 1, { buy_qty: 2, get_qty: 1 })).toBe(1);
    expect(freeUnitsAfterRemoval(1, 1, { buy_qty: 2, get_qty: 1 })).toBe(0);
    expect(freeUnitsAfterRemoval(4, 2, { buy_qty: 2, get_qty: 1 })).toBe(2);
    expect(freeUnitsAfterRemoval(3, 2, { buy_qty: 2, get_qty: 1 })).toBe(1);
    expect(freeUnitsAfterRemoval(10, 1, { buy_qty: 2, get_qty: 1 })).toBe(1);
  });

  it('offerStatus follows the switch and the schedule', () => {
    const at = new Date('2026-10-06T06:30:00.000Z');
    expect(offerStatus({ is_active: false, starts_at: null, ends_at: null }, at)).toBe('OFF');
    expect(offerStatus({ is_active: true, starts_at: '2026-10-07T00:00:00+05:30', ends_at: null }, at)).toBe('SCHEDULED');
    expect(offerStatus({ is_active: true, starts_at: null, ends_at: '2026-10-06T12:00:00+05:30' }, at)).toBe('ENDED');
    expect(offerStatus({ is_active: true, starts_at: '2026-10-06T00:00:00+05:30', ends_at: '2026-10-08T00:00:00+05:30' }, at)).toBe('LIVE');
  });
});

// ============================================================================
describe('Staff settings: GET | PUT /admin/settings/bundle-offers', () => {
  it('Admin and Operations edit it; nobody else', async () => {
    const p = await product(100);
    for (const token of [tokens.customer, tokens.staff, tokens.rider]) {
      expect((await getOffers(token)).status).toBe(403);
      expect((await put([buyGet([p.productId])], token)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/admin/settings/bundle-offers')).status).toBe(401);
    expect((await getOffers(opsToken)).status).toBe(200);
    const saved = await put([buyGet([p.productId])], opsToken);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body.data.ready).toBe(true);
    expect(saved.body.data.offers[0]).toMatchObject({
      type: 'BUY_X_GET_Y',
      status: 'LIVE',
      buy_qty: 2,
      get_qty: 1,
      category_id: null,
      min_subtotal: null,
      gift_product_id: null,
      product_names: [{ id: p.productId }],
    });
    expect(saved.body.data.offers[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('what GET returns can be PUT back unchanged, and the change is audited', async () => {
    const p = await product(100);
    const g = await product(40);
    const first = await setOffers([buyGet([p.productId]), spendGift(300, g.productId)]);
    const again = await put(first.offers);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.data.offers.map((o: { id: string }) => o.id)).toEqual(first.offers.map((o: { id: string }) => o.id));
    expect(again.body.data.offers[1]).toMatchObject({ type: 'SPEND_GET_GIFT', min_subtotal: 300, gift_product_id: g.productId, gift_qty: 1, gift_product_name: expect.any(String) });
    const audit = await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'BUNDLE_OFFERS_UPDATED' AND created_at >= $1`, [testStart]);
    expect(audit.rowCount).toBeGreaterThanOrEqual(2);
  });

  it('refuses bad rules with field errors', async () => {
    const p = await product(100);
    const bad = async (offers: unknown, code = 400) => {
      const res = await put(offers);
      expect(res.status, JSON.stringify(res.body)).toBe(code);
      return res;
    };
    await bad([buyGet([p.productId], { category_id: catParent })]); // both scopes
    await bad([buyGet(null)]); // neither scope
    await bad([buyGet([p.productId], { buy_qty: 0 })]);
    await bad([buyGet([p.productId], { get_qty: 11 })]);
    await bad([buyGet([p.productId], { title: 'x' })]);
    await bad([buyGet([p.productId, p.productId])]);
    await bad([buyGet([p.productId], { starts_at: '2026-10-08T00:00:00+05:30', ends_at: '2026-10-07T00:00:00+05:30' })]);
    await bad([buyGet([p.productId], { min_subtotal: 100 })]); // a field of the other type
    await bad([spendGift(0, p.productId)]);
    await bad([spendGift(100, 'not-a-uuid')]);
    await bad([{ type: 'NOPE', title: 'Whatever' }]);
    await bad(Array.from({ length: 11 }, () => buyGet([p.productId])));
    await bad([buyGet(['11111111-1111-4111-8111-111111111111'])], 400); // unknown product
    await bad([buyGet(null, { category_id: '11111111-1111-4111-8111-111111111111' })], 400); // unknown category
    const dup = await setOffers([buyGet([p.productId])]);
    const id = dup.offers[0].id;
    await bad([{ ...buyGet([p.productId]), id }, { ...buyGet([p.productId]), id }]);
    const res = await put([buyGet([p.productId], { buy_qty: 0 })]);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('GET /store lists only the LIVE offers, in order', async () => {
    const p = await product(100);
    const g = await product(40);
    await setOffers([
      buyGet([p.productId], { title: 'Live one' }),
      buyGet([p.productId], { title: 'Switched off', is_active: false }),
      buyGet([p.productId], { title: 'Coming soon', starts_at: '2026-10-08T00:00:00+05:30' }),
      buyGet([p.productId], { title: 'Over', ends_at: '2026-10-05T00:00:00+05:30' }),
      buyGet(null, { title: 'Category one', category_id: catChild }),
      spendGift(500, g.productId, { title: 'Gift one' }),
    ]);
    const store = (await request(app).get('/api/v1/store')).body.data.bundle_offers as Array<Record<string, any>>;
    expect(store.map((o) => o.title)).toEqual(['Live one', 'Category one', 'Gift one']);
    expect(store[0]).toMatchObject({ type: 'BUY_X_GET_Y', buy_qty: 2, get_qty: 1, product_ids: [p.productId], category: null, min_subtotal: null, gift_product_id: null });
    expect(store[1].category).toMatchObject({ id: catChild, slug: `bun-child-${stamp}` });
    expect(store[2]).toMatchObject({ type: 'SPEND_GET_GIFT', min_subtotal: 500, gift_product_id: g.productId, gift_qty: 1, gift_product_name: expect.any(String) });
    // A gift whose product was switched off is not advertised.
    await pool.query('UPDATE products SET is_active = false WHERE id = $1', [g.productId]);
    const after = (await request(app).get('/api/v1/store')).body.data.bundle_offers as Array<{ title: string }>;
    expect(after.map((o) => o.title)).toEqual(['Live one', 'Category one']);
  });

  it('before migration 062: the settings save but say ready false, /store lists none and no offer applies', async () => {
    const p = await product(100);
    await setOffers([buyGet([p.productId])]);
    setBundleOffersReadyForTests(false);
    expect((await getOffers()).body.data).toMatchObject({ ready: false });
    expect((await request(app).get('/api/v1/store')).body.data.bundle_offers).toEqual([]);
    const q = await quoteData([{ product_id: p.productId, quantity: 3 }]);
    expect(q).toMatchObject({ ready: false, subtotal: 300, bundle_savings: 0, bundle_applied: [], gift_items: [], bundle_progress: null });
    const order = await place([{ product_id: p.productId, quantity: 3 }]);
    expect(order).toMatchObject({ bundle_savings: 0, bundle_applied: [], gift_items: [], subtotal_amount: 300 });
    expect(await dbItems(order.id)).toHaveLength(1);
  });
});

// ============================================================================
describe('Buy X get Y free', () => {
  it('buy 2 get 1 on 2, 3, 4 and 6 units of one price', async () => {
    const p = await product(100);
    await setOffers([buyGet([p.productId])]);
    const at = async (n: number) => quoteData([{ product_id: p.productId, quantity: n }]);

    const two = await at(2);
    expect(two).toMatchObject({ ready: true, subtotal_before_bundles: 200, subtotal: 200, bundle_savings: 0, bundle_applied: [] });
    expect(two.bundle_progress).toMatchObject({ type: 'BUY_X_GET_Y', remaining_units: 1, buy_qty: 2, get_qty: 1, product_ids: [p.productId] });
    expect(two.lines).toEqual([{ product_id: p.productId, variant_id: null, quantity: 2, paid_quantity: 2, free_quantity: 0, unit_price: 100 }]);

    const three = await at(3);
    expect(three).toMatchObject({ subtotal_before_bundles: 300, subtotal: 200, bundle_savings: 100, bundle_progress: null });
    expect(three.bundle_applied).toEqual([expect.objectContaining({ title: 'Buy 2 get 1 free', type: 'BUY_X_GET_Y', savings_lkr: 100, free_units: 1 })]);
    expect(three.lines[0]).toMatchObject({ quantity: 3, paid_quantity: 2, free_quantity: 1 });

    const four = await at(4);
    expect(four).toMatchObject({ subtotal: 300, bundle_savings: 100 });
    expect(four.bundle_progress).toMatchObject({ remaining_units: 2 });

    const six = await at(6);
    expect(six).toMatchObject({ subtotal: 400, bundle_savings: 200 });
    expect(six.bundle_applied[0]).toMatchObject({ free_units: 2, savings_lkr: 200 });
    expect(six.bundle_progress).toBeNull();
  });

  it('mixed prices: the cheapest units are the free ones, never more than were bought', async () => {
    const a = await product(100);
    const b = await product(30);
    const c = await product(50);
    await setOffers([buyGet([a.productId, b.productId, c.productId])]);
    // 4 units (100, 100, 30, 50): 1 free = the 30.
    let q = await quoteData([
      { product_id: a.productId, quantity: 2 },
      { product_id: b.productId, quantity: 1 },
      { product_id: c.productId, quantity: 1 },
    ]);
    expect(q).toMatchObject({ subtotal_before_bundles: 280, subtotal: 250, bundle_savings: 30 });
    expect(q.lines.map((l: any) => [l.free_quantity, l.paid_quantity])).toEqual([[0, 2], [1, 0], [0, 1]]);
    // 6 units (3 x 100, 3 x 30): the two cheapest are free = 2 x 30.
    q = await quoteData([
      { product_id: a.productId, quantity: 3 },
      { product_id: b.productId, quantity: 3 },
    ]);
    expect(q).toMatchObject({ subtotal_before_bundles: 390, subtotal: 330, bundle_savings: 60 });
    // 9 units of one cheap product + 3 dear ones: 4 free, all of the cheap ones.
    q = await quoteData([
      { product_id: a.productId, quantity: 3 },
      { product_id: b.productId, quantity: 9 },
    ]);
    expect(q.bundle_savings).toBe(120);
    expect(q.lines[1]).toMatchObject({ free_quantity: 4, paid_quantity: 5 });
  });

  it('the placed order: a free line at price 0, totals, DTO fields, and the preview equals the order', async () => {
    const a = await product(100);
    const b = await product(40);
    await setOffers([buyGet([a.productId, b.productId], { title: 'Mix and match' })]);
    const items = [
      { product_id: a.productId, quantity: 2 },
      { product_id: b.productId, quantity: 1 },
    ];
    const q = await quoteData(items);
    const order = await place(items);
    const row = await dbOrder(order.id);
    expect(row.subtotal).toBe(q.subtotal);
    expect(row.subtotal).toBe(200);
    expect(r2(row.subtotal + row.fee - row.discount - row.wallet)).toBe(row.total);
    expect(order).toMatchObject({ subtotal_amount: 200, bundle_savings: 40, gift_items: [] });
    expect(order.bundle_applied).toEqual(q.bundle_applied);
    const lines = await dbItems(order.id);
    expect(lines).toHaveLength(2); // a paid line of A (2) and a free line of B (1)
    expect(lines.map((l) => [l.quantity, l.price, l.subtotal, l.bundle_kind])).toEqual([
      [2, 100, 200, null],
      [1, 0, 0, 'FREE_UNITS'],
    ]);
    expect(lines[1]).toMatchObject({ bundle_title: 'Mix and match', value: 40, product_id: b.productId });
    expect(lines[1].bundle_rule).toMatchObject({ buy_qty: 2, get_qty: 1 });
    const free = order.items.find((i: any) => i.is_bundle_free);
    expect(free).toMatchObject({ bundle_kind: 'FREE_UNITS', bundle_value: 40, unit_selling_price: 0, bundle_title: 'Mix and match' });
    expect(free).not.toHaveProperty('bundle_rule');
    expect(order.items.find((i: any) => !i.is_bundle_free)).toMatchObject({ bundle_kind: null, bundle_value: null });
    // The customer's own copies and the staff detail say the same.
    const mine = (await request(app).get(`/api/v1/orders/${order.id}`).set(auth(tokens.customer))).body.data.order;
    expect(mine).toMatchObject({ bundle_savings: 40, gift_items: [] });
    const list = (await request(app).get('/api/v1/orders').set(auth(tokens.customer))).body.data.orders as any[];
    expect(list.find((o) => o.id === order.id)).toMatchObject({ bundle_savings: 40 });
    const staff = (await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(tokens.admin))).body.data.order;
    expect(staff).toMatchObject({ bundle_savings: 40 });
    expect(staff.bundle_applied[0]).toMatchObject({ title: 'Mix and match', savings_lkr: 40, free_units: 1 });
    expect(staff.items.filter((i: any) => i.is_bundle_free)).toHaveLength(1);
  });

  it('a category offer covers its sub-categories; other categories are not matched', async () => {
    const inChild = await product(100, { category: catChild });
    const inParent = await product(100, { category: catParent });
    const outside = await product(100, { category: catOther });
    await setOffers([buyGet(null, { category_id: catParent })]);
    const q = await quoteData([
      { product_id: inChild.productId, quantity: 1 },
      { product_id: inParent.productId, quantity: 1 },
      { product_id: outside.productId, quantity: 1 },
    ]);
    expect(q.bundle_savings).toBe(0);
    expect(q.bundle_progress).toMatchObject({ remaining_units: 1, category_id: catParent });
    const q3 = await quoteData([
      { product_id: inChild.productId, quantity: 2 },
      { product_id: inParent.productId, quantity: 1 },
      { product_id: outside.productId, quantity: 5 },
    ]);
    expect(q3).toMatchObject({ bundle_savings: 100, subtotal: 700 });
    // 3 matching units (2 in the child + 1 in the parent): one free, the cheaper-or-first; the outside ones never.
    expect(q3.lines[0].free_quantity + q3.lines[1].free_quantity).toBe(1);
    expect(q3.lines[2].free_quantity).toBe(0);
  });

  it('several offers apply in rule order and never free the same unit twice', async () => {
    const p = await product(100);
    await setOffers([buyGet([p.productId], { title: 'First' }), buyGet([p.productId], { title: 'Second', buy_qty: 1, get_qty: 1 })]);
    const q = await quoteData([{ product_id: p.productId, quantity: 6 }]);
    expect(q.bundle_applied.map((a: any) => [a.title, a.free_units])).toEqual([['First', 2], ['Second', 2]]);
    expect(q.lines[0]).toMatchObject({ free_quantity: 4, paid_quantity: 2 });
    expect(q.subtotal).toBe(200);
    const order = await place([{ product_id: p.productId, quantity: 6 }]);
    const lines = await dbItems(order.id);
    expect(lines.reduce((n, l) => n + l.quantity, 0)).toBe(6); // the 6 ordered units, split - never 6 + extra
    expect(lines.filter((l) => l.bundle_kind === 'FREE_UNITS').map((l) => l.bundle_title).sort()).toEqual(['First', 'Second']);
  });

  it('an offer outside its schedule does not apply', async () => {
    const p = await product(100);
    await setOffers([
      buyGet([p.productId], { title: 'Tomorrow', starts_at: '2026-10-07T00:00:00+05:30' }),
      buyGet([p.productId], { title: 'Yesterday', ends_at: '2026-10-05T00:00:00+05:30' }),
      buyGet([p.productId], { title: 'Off', is_active: false }),
    ]);
    expect(await quoteData([{ product_id: p.productId, quantity: 3 }])).toMatchObject({ subtotal: 300, bundle_savings: 0, bundle_progress: null });
    await setOffers([buyGet([p.productId], { title: 'Now', starts_at: '2026-10-06T00:00:00+05:30', ends_at: '2026-10-07T00:00:00+05:30' })]);
    expect(await quoteData([{ product_id: p.productId, quantity: 3 }])).toMatchObject({ subtotal: 200, bundle_savings: 100 });
  });

  it('priceCart (what repeat baskets and order creation call) applies the same offers', async () => {
    const p = await product(100);
    await setOffers([buyGet([p.productId])]);
    const priced = await priceCart([{ product_id: p.productId, quantity: 3 }]);
    expect(priced.subtotal).toBe(200);
    expect(priced.items.map((i) => [i.quantity, i.unit_selling_price])).toEqual([[2, 100], [1, 0]]);
    expect(priced.bundle.bundle_savings).toBe(100);
  });

  it('refuses a bad quote request', async () => {
    expect((await request(app).post('/api/v1/orders/bundle-quote').send({ items: [] })).status).toBe(401);
    expect((await quote([{ product_id: 'x', quantity: 1 }])).status).toBe(400);
    expect((await request(app).post('/api/v1/orders/bundle-quote').set(auth(tokens.customer)).send({ items: [] })).status).toBe(400);
    expect((await quote([{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }])).status).toBe(400);
    expect((await quote([{ product_id: '11111111-1111-4111-8111-111111111111', quantity: 1 }], tokens.admin)).status).toBe(403);
  });
});

// ============================================================================
describe('Spend X, get a gift', () => {
  it('locks and unlocks around the threshold; one gift however much is spent', async () => {
    const p = await product(100);
    const g = await product(40);
    await setOffers([spendGift(250, g.productId, { title: 'Free gift over 250' })]);
    const at = (n: number) => quoteData([{ product_id: p.productId, quantity: n }]);

    const below = await at(2);
    expect(below).toMatchObject({ subtotal: 200, bundle_savings: 0, gift_items: [] });
    expect(below.bundle_progress).toMatchObject({ type: 'SPEND_GET_GIFT', remaining_lkr: 50, gift_product_id: g.productId, gift_qty: 1 });

    const exact = await quoteData([{ product_id: p.productId, quantity: 5 }]); // 500 >= 250
    expect(exact.gift_items).toEqual([{ product_id: g.productId, name: expect.any(String), quantity: 1, value_lkr: 40, offer_id: expect.any(String) }]);
    expect(exact).toMatchObject({ subtotal: 500, bundle_savings: 40, bundle_progress: null });
    expect(exact.bundle_applied[0]).toMatchObject({ type: 'SPEND_GET_GIFT', savings_lkr: 40, gift: { product_id: g.productId, quantity: 1, value_lkr: 40 } });

    const edge = await setOffers([spendGift(300, g.productId)]);
    expect(edge.offers).toHaveLength(1);
    expect((await at(3)).gift_items).toHaveLength(1); // 300 reaches 300
    expect((await at(10)).gift_items).toHaveLength(1); // still one
    expect((await at(2)).gift_items).toHaveLength(0);
  });

  it('counts the subtotal AFTER the buy-X offers, before delivery', async () => {
    const p = await product(100);
    const g = await product(40);
    await setOffers([buyGet([p.productId]), spendGift(250, g.productId)]);
    // 3 units: 300 before, 200 after the free unit - below 250, so no gift.
    const low = await quoteData([{ product_id: p.productId, quantity: 3 }]);
    expect(low).toMatchObject({ subtotal: 200, gift_items: [] });
    expect(low.bundle_progress).toMatchObject({ type: 'SPEND_GET_GIFT', remaining_lkr: 50 });
    // 4 units: 400 - 100 = 300: the gift unlocks.
    const high = await quoteData([{ product_id: p.productId, quantity: 4 }]);
    expect(high).toMatchObject({ subtotal: 300, bundle_savings: 140 });
    expect(high.gift_items).toHaveLength(1);
  });

  it('the placed order carries the gift as a real price-0 line, and its stock is reserved and packed', async () => {
    const p = await product(100);
    const g = await product(40, { onHand: 3 });
    await setOffers([spendGift(250, g.productId, { title: 'Gift over 250' })]);
    const order = await place([{ product_id: p.productId, quantity: 3 }]);
    const row = await dbOrder(order.id);
    expect(row.subtotal).toBe(300);
    expect(r2(row.subtotal + row.fee - row.discount - row.wallet)).toBe(row.total);
    expect(order).toMatchObject({ bundle_savings: 40 });
    expect(order.gift_items).toEqual([{ item_id: expect.any(String), product_id: g.productId, name: expect.any(String), quantity: 1, value_lkr: 40, offer_id: expect.any(String) }]);
    const lines = await dbItems(order.id);
    const gift = lines.find((l) => l.bundle_kind === 'GIFT')!;
    expect(gift).toMatchObject({ product_id: g.productId, quantity: 1, price: 0, subtotal: 0, item_status: 'PENDING', bundle_title: 'Gift over 250', value: 40 });
    expect(gift.bundle_rule).toMatchObject({ min_subtotal: 250, gift_qty: 1 });
    // Reserved: two more gifts' worth is all that is left for other customers.
    const left = (await pool.query('SELECT quantity_sellable FROM v_inventory_stock WHERE product_id = $1', [g.productId])).rows[0].quantity_sellable;
    expect(Number(left)).toBe(2);
    // Packed like any item: the unit leaves the shelf.
    expect((await fx.pack(order.id)).status).toBe(200);
    expect(await fx.onHand(g)).toBe(2);
  });

  it('a gift that is out of stock, switched off or needs a size is not given and not advertised as progress', async () => {
    const p = await product(100);
    const empty = await product(40, { onHand: 0 });
    await setOffers([spendGift(100, empty.productId)]);
    const q = await quoteData([{ product_id: p.productId, quantity: 2 }]);
    expect(q).toMatchObject({ gift_items: [], bundle_savings: 0, bundle_progress: null });
    const order = await place([{ product_id: p.productId, quantity: 2 }]);
    expect(order.gift_items).toEqual([]);
    expect(await dbItems(order.id)).toHaveLength(1);

    const off = await product(40, { onHand: 5 });
    await pool.query('UPDATE products SET is_available = false WHERE id = $1', [off.productId]);
    await setOffers([spendGift(100, off.productId)]);
    expect((await quoteData([{ product_id: p.productId, quantity: 2 }])).gift_items).toEqual([]);

    // The gift product already in the cart: its units come first (1 left, the cart takes it).
    const scarce = await product(40, { onHand: 1 });
    await setOffers([spendGift(100, scarce.productId)]);
    const withGift = await quoteData([{ product_id: p.productId, quantity: 2 }]);
    expect(withGift.gift_items).toHaveLength(1);
    const clash = await quoteData([
      { product_id: p.productId, quantity: 2 },
      { product_id: scarce.productId, quantity: 1 },
    ]);
    expect(clash.gift_items).toEqual([]);
  });

  it('two checkouts racing for the last gift: both succeed, exactly one gets it', async () => {
    const p = await product(100);
    const g = await product(40, { onHand: 1 });
    await setOffers([spendGift(100, g.productId)]);
    const send = () => request(app).post('/api/v1/orders').set(auth(tokens.customer)).send({ address_id: fx.addressId, items: [{ product_id: p.productId, quantity: 2 }] });
    const [one, two] = await Promise.all([send(), send()]);
    expect(one.status, JSON.stringify(one.body)).toBe(201);
    expect(two.status, JSON.stringify(two.body)).toBe(201);
    for (const r of [one, two]) fx.created.orders.push(r.body.data.order.id);
    const gifts = [one, two].map((r) => r.body.data.order.gift_items.length);
    expect(gifts.sort()).toEqual([0, 1]);
  });
});

// ============================================================================
describe('Together with coupon, points and the wallet', () => {
  it('the coupon follows the subtotal after bundles; the preview equals the order; the totals add up', async () => {
    const p = await product(100);
    await setOffers([buyGet([p.productId])]);
    const code = `TSTBUN${String(stamp).slice(-6)}`;
    coupons.push(code);
    await pool.query(`INSERT INTO coupons (code, discount_type, discount_value, is_active) VALUES ($1, 'PERCENT', 10, true)`, [code]);
    await pool.query(`INSERT INTO system_configurations (key, value, description) VALUES ('wallet', $1::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ enabled: true, expiry_months: 0, max_use_percent: 100 })]);
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ('points_program', $1::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ enabled: true, earn_points: 1, earn_per_lkr: 100, lkr_per_point: 1, min_redeem_points: 1, max_redeem_percent: 10, expiry_months: 0 })]
    );
    const me = await people.customer(1);
    expect((await request(app).post(`/api/v1/admin/customers/${me.id}/wallet/adjust`).set(auth(tokens.admin)).send({ amount: 30, reason: 'Test credit' })).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/customers/${me.id}/points/adjust`).set(auth(tokens.admin)).send({ points: 50, reason: 'Gift' })).status).toBe(200);

    const items = [{ product_id: p.productId, quantity: 3 }];
    const preview = await request(app).post('/api/v1/orders/validate-coupon').set(auth(me.token)).send({ code, address_id: me.addressId, items });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const pv = preview.body.data.coupon;
    expect(pv).toMatchObject({ subtotal: 200, discount_amount: 20, bundle_savings: 100, subtotal_before_bundles: 300 });
    expect(pv.bundle_applied[0]).toMatchObject({ free_units: 1, savings_lkr: 100 });
    expect(pv.total).toBe(r2(200 + pv.delivery_fee - 20));

    const order = await expectCreated(await me.placeOrder(items, { coupon_code: code, use_points: true, use_wallet: true }));
    const row = await dbOrder(order.id);
    expect(row.subtotal).toBe(pv.subtotal);
    expect(row.fee).toBe(pv.delivery_fee);
    expect(order.points_discount_amount).toBeGreaterThan(0);
    expect(row.wallet).toBe(30);
    expect(row.discount).toBeGreaterThanOrEqual(20 + order.points_discount_amount - 0.01);
    expect(r2(row.subtotal + row.fee - row.discount - row.wallet)).toBe(row.total);
    expect(order).toMatchObject({ bundle_savings: 100, coupon_code: code });
    // A refund can never be more than was actually paid: the free unit adds nothing to it.
    const view = (await request(app).get(`/api/v1/admin/orders/${order.id}/wallet`).set(auth(tokens.admin))).body.data;
    // Only the wallet has paid so far (cash is collected at the door): that is all that could be refunded.
    expect(view.paid.total).toBe(row.wallet);
    expect(view.refundable).toBe(row.wallet);
    const tooMuch = await request(app).post(`/api/v1/admin/orders/${order.id}/wallet-refund`).set(auth(opsToken)).send({ amount: r2(view.refundable + 100), kind: 'REFUND_ITEM', reason: 'Free item refund attempt' });
    expect(tooMuch.status).toBe(422);
    await pool.query('DELETE FROM points_ledger WHERE user_id = $1', [me.id]).catch(() => undefined);
  });
});

// ============================================================================
describe('Removing an item from an order that has a bundle', () => {
  it('a removed paid unit takes the free unit it earned with it; the total never goes negative', async () => {
    const a = await product(100);
    const b = await product(30);
    await setOffers([buyGet([a.productId, b.productId])]);
    const order = await place([
      { product_id: a.productId, quantity: 2 },
      { product_id: b.productId, quantity: 1 },
    ]);
    let row = await dbOrder(order.id);
    expect(row.subtotal).toBe(200);
    const paid = (await dbItems(order.id)).find((l) => l.product_id === a.productId)!;
    const res = await fx.resolve(order.id, paid.id);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    row = await dbOrder(order.id);
    // Nothing left to pay for but the fee: the paid line is gone and so is the free unit.
    expect(row.subtotal).toBe(0);
    expect(row.total).toBe(r2(row.fee));
    const lines = await dbItems(order.id);
    expect(lines.every((l) => l.item_status === 'UNAVAILABLE')).toBe(true);
    expect(res.body.data.order).toMatchObject({ bundle_savings: 0, gift_items: [], bundle_applied: [] });
    expect(r2(row.subtotal + row.fee - row.discount - row.wallet)).toBe(row.total);
  });

  it('removing one paid unit of a bigger bundle cuts the free units to what the rest earns', async () => {
    const a = await product(100);
    await setOffers([buyGet([a.productId], { title: 'Two free' , buy_qty: 1, get_qty: 1 })]);
    // 6 units, buy 1 get 1: 3 free + 3 paid.
    const order = await place([{ product_id: a.productId, quantity: 6 }]);
    expect((await dbOrder(order.id)).subtotal).toBe(300);
    // Two separate order lines of the same product are not possible by hand, so remove the paid line and check the result.
    const paid = (await dbItems(order.id)).find((l) => l.bundle_kind === null)!;
    expect(paid.quantity).toBe(3);
    expect((await fx.resolve(order.id, paid.id)).status).toBe(200);
    const after = await dbItems(order.id);
    expect(after.filter((l) => l.item_status !== 'UNAVAILABLE')).toHaveLength(0);
    expect((await dbOrder(order.id)).subtotal).toBe(0);
  });

  it('removing a free unit or a gift changes no money; removing a paid item never refunds more than it cost', async () => {
    const a = await product(100);
    const b = await product(100);
    const g = await product(40);
    await setOffers([buyGet([a.productId]), spendGift(250, g.productId)]);
    const me = await people.customer(2);
    await pool.query(`INSERT INTO system_configurations (key, value, description) VALUES ('wallet', $1::jsonb, 'test') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify({ enabled: true, expiry_months: 0, max_use_percent: 100 })]);
    expect((await request(app).post(`/api/v1/admin/customers/${me.id}/wallet/adjust`).set(auth(tokens.admin)).send({ amount: 500, reason: 'Test credit' })).status).toBe(200);
    // a x3 (1 free), b x2: subtotal 200 + 200 = 400 >= 250 -> a gift too. The wallet pays 400 of it.
    const order = await expectCreated(await me.placeOrder([{ product_id: a.productId, quantity: 3 }, { product_id: b.productId, quantity: 2 }], { use_wallet: true }));
    fx.created.orders.push(order.id);
    let row = await dbOrder(order.id);
    expect(row.subtotal).toBe(400);
    expect(order.gift_items).toHaveLength(1);
    const lines = await dbItems(order.id);
    const gift = lines.find((l) => l.bundle_kind === 'GIFT')!;
    const free = lines.find((l) => l.bundle_kind === 'FREE_UNITS')!;
    const beforeTotal = row.total;
    const beforeWallet = row.wallet;

    // Staff cannot find the gift: the order is unchanged money-wise.
    expect((await fx.resolve(order.id, gift.id)).status).toBe(200);
    row = await dbOrder(order.id);
    expect([row.subtotal, row.total, row.wallet]).toEqual([400, beforeTotal, beforeWallet]);

    // Remove b (paid, 200): the order is 200 cheaper, the wallet gives back exactly what it no longer owes.
    const bLine = lines.find((l) => l.product_id === b.productId)!;
    expect((await fx.resolve(order.id, bLine.id)).status).toBe(200);
    row = await dbOrder(order.id);
    expect(row.subtotal).toBe(200);
    expect(row.wallet).toBeLessThanOrEqual(beforeWallet);
    expect(r2(row.subtotal + row.fee - row.discount - row.wallet)).toBe(row.total);
    const returned = (await pool.query(`SELECT COALESCE(SUM(amount), 0)::float AS n FROM wallet_entries WHERE order_id = $1 AND kind = 'ORDER_PAYMENT_RETURNED'`, [order.id])).rows[0].n;
    expect(r2(returned)).toBe(r2(beforeWallet - row.wallet));
    expect(returned).toBeLessThanOrEqual(200 + 0.01);
    // The a-bundle (2 paid + 1 free) is intact, so the free unit stays.
    expect((await dbItems(order.id)).find((l) => l.id === free.id)!.item_status).toBe('PENDING');
  });
});

// ============================================================================
describe('Delivered orders keep their bundle facts', () => {
  it('a delivered order with a free unit settles with the same totals and bundle_savings', async () => {
    const a = await product(100);
    await setOffers([buyGet([a.productId])]);
    const order = await place([{ product_id: a.productId, quantity: 3 }]);
    expect((await fx.pack(order.id)).status).toBe(200);
    await fx.deliver(order.id);
    const done = (await request(app).get(`/api/v1/orders/${order.id}`).set(auth(tokens.customer))).body.data.order;
    expect(done).toMatchObject({ order_status: 'DELIVERED', subtotal_amount: 200, bundle_savings: 100 });
    expect(done.items.filter((i: any) => i.is_bundle_free)).toHaveLength(1);
  });
});
