import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { cartRulesFrom, cartRulesService } from '../src/modules/configuration/cart-rules.js';
import { runDueRepeatBaskets } from '../src/modules/repeat-baskets/repeat.runner.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures } from './helpers/customers.js';

/**
 * One seller per order (owner's brother, 2026-10-27, "Option A"): the cart_rules setting (ON by default, no
 * migration), GET /store's `one_seller_per_order`, `seller_id` on the customer's products, and POST /orders
 * refusing a cart of several sources (sellers, or a seller and Blynk's own) with 422 MIXED_SELLERS_NOT_ALLOWED
 * before anything is reserved. Repeat baskets (the only other caller of the order service) record the refusal as
 * a FAILED run. The suite-wide pin that switches the rule off (tests/setup/cart-rules.ts) is removed here.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-CRL-');
const people = customerFixtures(app, { idPrefix: 'c0c00066', phoneBase: '+947096600', name: 'Cart Rules Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const SELLER_PHONE_BASE = '+947096610';
const DUE = '2026-10-06T06:00:00.000Z'; // half an hour before the pinned ordering clock

const pinned = cartRulesService.read;
type Row = { key: string; value: unknown; description: string | null; created_at: Date; updated_at: Date };
let saved: Row | undefined;
let testStart: Date;
let blynk1 = '';
let blynk2 = '';
let blynkTracked = { productId: '', inventoryId: '' };
let sellerA = '';
let sellerB = '';
let sellerSuspended = '';
let a1 = '';
let a2 = '';
let b1 = '';
let suspendedProduct = '';
const sellerUsers: string[] = [];

const get = (token = tokens.admin) => request(app).get('/api/v1/admin/settings/cart-rules').set(auth(token));
const patch = (body: object, token = tokens.admin) => request(app).patch('/api/v1/admin/settings/cart-rules').set(auth(token)).send(body);
const store = async () => (await request(app).get('/api/v1/store')).body.data;
const setRule = async (enabled: boolean) => {
  const res = await patch({ one_seller_per_order: { enabled } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
};
const deleteRow = () => pool.query("DELETE FROM system_configurations WHERE key = 'cart_rules'");
const customerProduct = async (id: string) => (await request(app).get(`/api/v1/products/${id}`)).body.data.product;

async function makeSeller(n: number, shop: string, status: 'APPROVED' | 'SUSPENDED' = 'APPROVED') {
  const user = (
    await pool.query(`INSERT INTO users (phone, full_name, role) VALUES ($1, $2, 'SELLER') RETURNING id`, [
      `${SELLER_PHONE_BASE}${String(n).padStart(2, '0')}`,
      `Cart rules ${shop}`,
    ])
  ).rows[0].id as string;
  sellerUsers.push(user);
  return (await pool.query('INSERT INTO sellers (user_id, shop_name, status) VALUES ($1, $2, $3) RETURNING id', [user, shop, status])).rows[0].id as string;
}

async function ownedBy(sellerId: string | null, extra: { tracked?: boolean; onHand?: number } = {}) {
  const t = await fx.product({ tracked: extra.tracked ?? false, onHand: extra.onHand });
  if (sellerId) await pool.query('UPDATE products SET seller_id = $2 WHERE id = $1', [t.productId, sellerId]);
  return t;
}

async function purgeSellers() {
  await pool.query(`UPDATE products SET seller_id = NULL WHERE seller_id IN (SELECT s.id FROM sellers s JOIN users u ON u.id = s.user_id WHERE u.phone LIKE $1)`, [
    `${SELLER_PHONE_BASE}%`,
  ]);
  await pool.query('DELETE FROM sellers WHERE user_id IN (SELECT id FROM users WHERE phone LIKE $1)', [`${SELLER_PHONE_BASE}%`]);
  await pool.query('DELETE FROM users WHERE phone LIKE $1', [`${SELLER_PHONE_BASE}%`]);
}

beforeAll(async () => {
  // The real reader (the suite pins the rule off in tests/setup/cart-rules.ts).
  delete (cartRulesService as { read?: unknown }).read;
  await people.purge();
  await purgeSellers();
  await fx.setup();
  testStart = (await pool.query('SELECT now() AS t')).rows[0].t;
  saved = (await pool.query("SELECT key, value, description, created_at, updated_at FROM system_configurations WHERE key = 'cart_rules'")).rows[0];
  await deleteRow();

  sellerA = await makeSeller(1, 'Cart Rules Shop A');
  sellerB = await makeSeller(2, 'Cart Rules Shop B');
  sellerSuspended = await makeSeller(3, 'Cart Rules Shop Suspended', 'SUSPENDED');
  blynk1 = (await ownedBy(null)).productId;
  blynk2 = (await ownedBy(null)).productId;
  blynkTracked = await ownedBy(null, { tracked: true, onHand: 20 });
  a1 = (await ownedBy(sellerA)).productId;
  a2 = (await ownedBy(sellerA)).productId;
  b1 = (await ownedBy(sellerB)).productId;
  suspendedProduct = (await ownedBy(sellerSuspended)).productId;
}, 60_000);

afterAll(async () => {
  cartRulesService.read = pinned;
  await people.cleanup();
  await pool.query("DELETE FROM combos WHERE name LIKE 'TST-CRL-%'");
  await deleteRow();
  if (saved) {
    await pool.query(`INSERT INTO system_configurations (key, value, description, created_at, updated_at) VALUES ('cart_rules', $1, $2, $3, $4)`, [
      JSON.stringify(saved.value),
      saved.description,
      saved.created_at,
      saved.updated_at,
    ]);
  }
  await pool.query("DELETE FROM audit_logs WHERE action = 'CART_RULES_UPDATED' AND created_at >= $1", [testStart]);
  await fx.cleanup();
  await purgeSellers();
});

describe('cart_rules setting', () => {
  it('is ON when nothing is stored, in the admin read and in GET /store', async () => {
    await deleteRow();
    const res = await get(opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toEqual({ one_seller_per_order: { enabled: true }, updated_at: null });
    expect((await store()).one_seller_per_order).toBe(true);
  });

  it('tolerates a malformed row (back to the default, ON)', () => {
    expect(cartRulesFrom(null)).toEqual({ one_seller_per_order: { enabled: true } });
    expect(cartRulesFrom('nonsense')).toEqual({ one_seller_per_order: { enabled: true } });
    expect(cartRulesFrom({ one_seller_per_order: { enabled: 'yes' } })).toEqual({ one_seller_per_order: { enabled: true } });
    expect(cartRulesFrom({ one_seller_per_order: true })).toEqual({ one_seller_per_order: { enabled: true } });
    expect(cartRulesFrom({ one_seller_per_order: { enabled: false } })).toEqual({ one_seller_per_order: { enabled: false } });
    expect(cartRulesFrom('{"one_seller_per_order":{"enabled":false}}')).toEqual({ one_seller_per_order: { enabled: false } });
  });

  it('a malformed stored row still reads (admin, /store, orders)', async () => {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ('cart_rules', $1, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ one_seller_per_order: { enabled: 'maybe' } })]
    );
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.data.one_seller_per_order).toEqual({ enabled: true });
    expect((await store()).one_seller_per_order).toBe(true);
    await deleteRow();
  });

  it('saves with an audit entry; GET /store follows; a key it does not know is kept', async () => {
    await pool.query(
      `INSERT INTO system_configurations (key, value, description) VALUES ('cart_rules', $1, 'test')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ mixed_within_km: { enabled: false, km: 3 } })]
    );
    const off = await patch({ one_seller_per_order: { enabled: false } }, opsToken);
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.data.one_seller_per_order).toEqual({ enabled: false });
    expect(typeof off.body.data.updated_at).toBe('string');
    expect((await get()).body.data.one_seller_per_order).toEqual({ enabled: false });
    expect((await store()).one_seller_per_order).toBe(false);
    const stored = (await pool.query("SELECT value FROM system_configurations WHERE key = 'cart_rules'")).rows[0].value;
    expect(stored).toEqual({ one_seller_per_order: { enabled: false }, mixed_within_km: { enabled: false, km: 3 } });

    const audit = (await pool.query("SELECT old_values, new_values FROM audit_logs WHERE action = 'CART_RULES_UPDATED' ORDER BY created_at DESC LIMIT 1")).rows[0];
    expect(audit.old_values).toMatchObject({ key: 'cart_rules', one_seller_per_order: { enabled: true } });
    expect(audit.new_values).toEqual({ key: 'cart_rules', one_seller_per_order: { enabled: false } });

    const on = await patch({ one_seller_per_order: { enabled: true } });
    expect(on.body.data.one_seller_per_order).toEqual({ enabled: true });
    expect((await store()).one_seller_per_order).toBe(true);
    await deleteRow();
  });

  it('validates the body strictly and the role', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ one_seller_per_order: {} })).status).toBe(400);
    expect((await patch({ one_seller_per_order: { enabled: 'yes' } })).status).toBe(400);
    expect((await patch({ one_seller_per_order: { enabled: 1 } })).status).toBe(400);
    expect((await patch({ one_seller_per_order: { enabled: true, km: 3 } })).status).toBe(400);
    expect((await patch({ one_seller_per_order: { enabled: true }, extra: 1 })).status).toBe(400);
    expect((await patch({ enabled: true })).status).toBe(400);
    expect((await patch({ one_seller_per_order: { enabled: true } }, tokens.staff)).status).toBe(403);
    expect((await patch({ one_seller_per_order: { enabled: true } }, tokens.customer)).status).toBe(403);
    expect((await get(tokens.staff)).status).toBe(403);
    expect((await get(tokens.customer)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/settings/cart-rules')).status).toBe(401);
    expect((await request(app).patch('/api/v1/admin/settings/cart-rules').send({ one_seller_per_order: { enabled: true } })).status).toBe(401);
    // Nothing was saved by the refused calls.
    expect((await pool.query("SELECT 1 FROM system_configurations WHERE key = 'cart_rules'")).rowCount).toBe(0);
  });
});

describe('seller_id on the customer products', () => {
  it('is the approved seller of the product (with sold_by), null for Blynk and for a suspended seller', async () => {
    const mine = await customerProduct(a1);
    expect(mine).toMatchObject({ id: a1, seller_id: sellerA, sold_by: 'Cart Rules Shop A' });
    expect(await customerProduct(blynk1)).toMatchObject({ seller_id: null, sold_by: null });
    expect(await customerProduct(suspendedProduct)).toMatchObject({ seller_id: null, sold_by: null });

    const list = (await request(app).get('/api/v1/products').query({ limit: 100, search: 'Stock test TST-CRL-' })).body.data.products as {
      id: string;
      seller_id: string | null;
      sold_by: string | null;
    }[];
    expect(list.length).toBeGreaterThanOrEqual(4);
    for (const p of list) expect(p).toHaveProperty('seller_id');
    expect(list.find((p) => p.id === b1)).toMatchObject({ seller_id: sellerB, sold_by: 'Cart Rules Shop B' });
    expect(list.find((p) => p.id === blynk2)?.seller_id).toBeNull();
  });
});

describe('POST /orders with one seller per order ON', () => {
  const orderCount = async (customerId: string) => (await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [customerId])).rows[0].n;
  const mixedBody = (res: request.Response) => {
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('MIXED_SELLERS_NOT_ALLOWED');
    expect(res.body.error.message).toBe('Your cart has items from different sellers. Please order from one seller at a time.');
    return res.body.error.details.sources as { seller_id: string | null; name: string }[];
  };

  beforeAll(async () => {
    await setRule(true);
  });

  it('refuses a seller and Blynk cart, naming the sources, and reserves nothing', async () => {
    const me = await people.customer(1);
    const before = (await pool.query('SELECT * FROM inventory WHERE id = $1', [blynkTracked.inventoryId])).rows[0];
    const res = await me.placeOrder([
      { product_id: blynkTracked.productId, quantity: 2 },
      { product_id: a1, quantity: 1 },
    ]);
    expect(mixedBody(res)).toEqual([
      { seller_id: null, name: 'Blynk' },
      { seller_id: sellerA, name: 'Cart Rules Shop A' },
    ]);
    expect(await orderCount(me.id)).toBe(0);
    expect((await pool.query('SELECT * FROM inventory WHERE id = $1', [blynkTracked.inventoryId])).rows[0]).toEqual(before);
  });

  it('refuses two sellers', async () => {
    const me = await people.customer(2);
    const res = await me.placeOrder([
      { product_id: b1, quantity: 1 },
      { product_id: a1, quantity: 1 },
    ]);
    expect(mixedBody(res)).toEqual([
      { seller_id: sellerA, name: 'Cart Rules Shop A' },
      { seller_id: sellerB, name: 'Cart Rules Shop B' },
    ]);
    expect(await orderCount(me.id)).toBe(0);
  });

  it('refuses a combo that contains a seller product next to Blynk items', async () => {
    const price = (id: string) => request(app).get(`/api/v1/admin/products/${id}`).set(auth(tokens.admin)).then((r) => Number(r.body.data.product.calculated_selling_price));
    const total = (await price(a1)) + (await price(blynk1));
    const created = await request(app)
      .post('/api/v1/admin/combos')
      .set(auth(tokens.admin))
      .send({
        name: `TST-CRL-mixed-${Date.now()}`,
        price: Number((total - 5).toFixed(2)),
        items: [
          { product_id: a1, quantity: 1 },
          { product_id: blynk1, quantity: 1 },
        ],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const comboId = created.body.data.combo.id as string;

    const me = await people.customer(3);
    // The combo alone is already two sources (the seller's product and Blynk's).
    expect(mixedBody(await me.placeOrder([], { combos: [{ combo_id: comboId, quantity: 1 }] }))).toEqual([
      { seller_id: null, name: 'Blynk' },
      { seller_id: sellerA, name: 'Cart Rules Shop A' },
    ]);
    expect(await orderCount(me.id)).toBe(0);
  });

  it("a Blynk loose item with a seller's combo is refused; a seller's combo with the same seller's item is allowed", async () => {
    const price = (id: string) => request(app).get(`/api/v1/admin/products/${id}`).set(auth(tokens.admin)).then((r) => Number(r.body.data.product.calculated_selling_price));
    const total = (await price(a1)) + (await price(a2));
    const created = await request(app)
      .post('/api/v1/admin/combos')
      .set(auth(tokens.admin))
      .send({
        name: `TST-CRL-seller-${Date.now()}`,
        price: Number((total - 5).toFixed(2)),
        items: [
          { product_id: a1, quantity: 1 },
          { product_id: a2, quantity: 1 },
        ],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const comboId = created.body.data.combo.id as string;
    const me = await people.customer(4);
    const refused = await me.placeOrder([{ product_id: blynk1, quantity: 1 }], { combos: [{ combo_id: comboId, quantity: 1 }] });
    expect(mixedBody(refused)).toEqual([
      { seller_id: null, name: 'Blynk' },
      { seller_id: sellerA, name: 'Cart Rules Shop A' },
    ]);
    expect(await orderCount(me.id)).toBe(0);

    const ok = await me.placeOrder([{ product_id: a1, quantity: 1 }], { combos: [{ combo_id: comboId, quantity: 1 }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('allows one seller only, Blynk only, and the same seller repeated', async () => {
    const me = await people.customer(5);
    expect((await me.placeOrder([{ product_id: a1, quantity: 1 }])).status).toBe(201);
    expect((await me.placeOrder([{ product_id: blynk1, quantity: 1 }, { product_id: blynk2, quantity: 2 }])).status).toBe(201);
    // Two products of the same seller, and the same seller again in a later order.
    expect((await me.placeOrder([{ product_id: a1, quantity: 1 }, { product_id: a2, quantity: 3 }])).status).toBe(201);
    expect((await me.placeOrder([{ product_id: a2, quantity: 1 }])).status).toBe(201);
    expect((await me.placeOrder([{ product_id: b1, quantity: 1 }])).status).toBe(201);
  });

  it("a suspended seller's product counts as Blynk's (what the app sees), so it mixes with a Blynk item", async () => {
    const me = await people.customer(6);
    const res = await me.placeOrder([{ product_id: suspendedProduct, quantity: 1 }, { product_id: blynk1, quantity: 1 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });

  it('an order accepted earlier still replays after the rule refuses the same cart', async () => {
    const me = await people.customer(7);
    const key = `crl-replay-${Date.now()}`;
    await setRule(false);
    const first = await me.placeOrder([{ product_id: a1, quantity: 1 }, { product_id: blynk1, quantity: 1 }], { idempotency_key: key });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    await setRule(true);
    const again = await me.placeOrder([{ product_id: a1, quantity: 1 }, { product_id: blynk1, quantity: 1 }], { idempotency_key: key });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(again.body.data.order.id).toBe(first.body.data.order.id);
    expect(await orderCount(me.id)).toBe(1);
  });

  it('switched off, a mixed cart is placed as before; switched back on it is refused again', async () => {
    const me = await people.customer(8);
    await setRule(false);
    const items = [
      { product_id: a1, quantity: 1 },
      { product_id: b1, quantity: 1 },
      { product_id: blynk1, quantity: 1 },
    ];
    const ok = await me.placeOrder(items);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await store()).one_seller_per_order).toBe(false);
    await setRule(true);
    expect((await me.placeOrder(items)).status).toBe(422);
    expect(await orderCount(me.id)).toBe(1);
  });

  it('with no stored setting the rule is ON (the default)', async () => {
    await deleteRow();
    const me = await people.customer(9);
    const res = await me.placeOrder([{ product_id: a1, quantity: 1 }, { product_id: blynk1, quantity: 1 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error.code).toBe('MIXED_SELLERS_NOT_ALLOWED');
  });
});

describe('repeat baskets with a mixed basket', () => {
  async function makeBasket(token: string, addressId: string, items: { product_id: string; quantity: number }[]) {
    const res = await request(app)
      .post('/api/v1/me/repeat-baskets')
      .set(auth(token))
      .send({ name: 'Mixed basket', items, frequency: 'DAILY', place_at: '11:30', address_id: addressId });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.basket.id as string;
    await pool.query('UPDATE repeat_baskets SET next_run_at = $2 WHERE id = $1', [id, DUE]);
    return id;
  }
  const runsOf = async (id: string) => (await pool.query('SELECT status, reason, order_id FROM repeat_basket_runs WHERE basket_id = $1 ORDER BY created_at', [id])).rows;

  it('records a FAILED run with the reason, places nothing, moves on and tells the customer', async () => {
    await setRule(true);
    const me = await people.customer(10);
    const id = await makeBasket(me.token, me.addressId, [
      { product_id: a1, quantity: 1 },
      { product_id: blynk1, quantity: 1 },
    ]);
    expect(await runDueRepeatBaskets({ basketIds: [id] })).toEqual({ placed: 0, skipped: 0, failed: 1 });
    expect(await runsOf(id)).toEqual([
      { status: 'FAILED', reason: 'This basket has items from different sellers. Please keep items from one seller only', order_id: null },
    ]);
    expect((await pool.query('SELECT count(*)::int AS n FROM orders WHERE customer_id = $1', [me.id])).rows[0].n).toBe(0);
    const basket = (await pool.query('SELECT next_run_at, last_order_id FROM repeat_baskets WHERE id = $1', [id])).rows[0];
    expect(basket.last_order_id).toBeNull();
    expect(basket.next_run_at.toISOString()).toBe('2026-10-07T06:00:00.000Z');
    const sms = (await pool.query(`SELECT payload FROM notifications WHERE user_id = $1 AND notification_type = 'REPEAT_BASKET'`, [me.id])).rows;
    expect(sms).toHaveLength(1);
    expect(JSON.stringify(sms[0].payload)).toContain('could not order your repeat basket');
    expect(JSON.stringify(sms[0].payload)).toContain('different sellers');
  });

  it('a one-seller basket is still placed; with the rule off a mixed one is placed too', async () => {
    await setRule(true);
    const me = await people.customer(11);
    const one = await makeBasket(me.token, me.addressId, [
      { product_id: a1, quantity: 1 },
      { product_id: a2, quantity: 1 },
    ]);
    expect(await runDueRepeatBaskets({ basketIds: [one] })).toEqual({ placed: 1, skipped: 0, failed: 0 });

    await setRule(false);
    const mixed = await makeBasket(me.token, me.addressId, [
      { product_id: a1, quantity: 1 },
      { product_id: blynk1, quantity: 1 },
    ]);
    expect(await runDueRepeatBaskets({ basketIds: [mixed] })).toEqual({ placed: 1, skipped: 0, failed: 0 });
  });
});
