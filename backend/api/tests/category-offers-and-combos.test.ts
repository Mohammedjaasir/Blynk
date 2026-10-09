import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { bestOffer, categoryOfferPrice } from '../src/modules/catalog/catalog.offers.js';
import { allocateComboPrice } from '../src/modules/catalog/catalog.combos.js';
import { riderRepository } from '../src/modules/riders/rider.repository.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';

/**
 * Category offers and combo packs (migration 033; owner, 2026-10-09).
 *
 * - A category offer takes a % off everything in a category and its
 *   sub-categories; a product with its own offer too costs the LOWER of the
 *   two. It reaches customers through the same offer_price fields.
 * - A combo pack is several products at one price. The order charges the
 *   combo price; its items are ordinary order items sharing that price, so
 *   packing and stock work on them unchanged.
 *
 * Everything made here (categories, products, combos, orders, audit rows) is
 * removed afterwards.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-CMB-');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const TAG = `TST-CMB-${Date.now()}`;

const made = { categories: [] as string[], combos: [] as string[] };
let parentId = '';
let childId = '';
let bakeryBread = ''; // in the parent category
let bunProduct = ''; // in the sub-category
let breadSelling = 0;
let bunSelling = 0;

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const customerView = async (id: string) => (await request(app).get(`/api/v1/products/${id}`)).body.data.product;
const adminProduct = async (id: string) =>
  (await request(app).get(`/api/v1/admin/products/${id}`).set(auth(tokens.admin))).body.data.product;
const setOffer = (id: string, body: object, token = opsToken) =>
  request(app).put(`/api/v1/admin/categories/${id}/offer`).set(auth(token)).send(body);
const removeOffer = (id: string, token = tokens.admin) => request(app).delete(`/api/v1/admin/categories/${id}/offer`).set(auth(token));

async function category(name: string, parent?: string) {
  const res = await request(app)
    .post('/api/v1/admin/categories')
    .set(auth(tokens.admin))
    .send({ name: `${TAG} ${name}`, ...(parent ? { parent_id: parent } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  made.categories.push(res.body.data.category.id);
  return res.body.data.category.id as string;
}

async function productIn(categoryId: string, name: string, cost: number) {
  const res = await request(app)
    .post('/api/v1/admin/products')
    .set(auth(tokens.admin))
    .send({ category_id: categoryId, name: `${TAG} ${name}`, sku: `TST-CMB-${name}-${Date.now()}`, unit: '1 pc', purchase_cost: cost, custom_markup_percent: 25 });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  fx.created.products.push(res.body.data.product.id);
  return res.body.data.product as { id: string; calculated_selling_price: number };
}

const placeOrder = async (items: object[], combos?: object[]) => {
  const res = await request(app)
    .post('/api/v1/orders')
    .set(auth(tokens.customer))
    .send({ address_id: fx.addressId, items, ...(combos ? { combos } : {}) });
  if (res.status === 201) fx.created.orders.push(res.body.data.order.id);
  return res;
};

beforeAll(async () => {
  await pool.query(`DELETE FROM combos WHERE name LIKE 'TST-CMB-%'`);
  await fx.setup();
  await pool.query(`DELETE FROM categories WHERE name LIKE 'TST-CMB-%' AND parent_id IS NOT NULL`);
  await pool.query(`DELETE FROM categories WHERE name LIKE 'TST-CMB-%'`);
  parentId = await category('Bakery');
  childId = await category('Buns', parentId);
  const bread = await productIn(parentId, 'BREAD', 200); // selling 250
  const bun = await productIn(childId, 'BUN', 80); // selling 100
  bakeryBread = bread.id;
  bunProduct = bun.id;
  breadSelling = bread.calculated_selling_price;
  bunSelling = bun.calculated_selling_price;
  expect(breadSelling).toBe(250);
  expect(bunSelling).toBe(100);
});

afterAll(async () => {
  await fx.cleanup();
  if (made.combos.length) {
    await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [made.combos]);
    await pool.query('DELETE FROM combos WHERE id = ANY($1)', [made.combos]);
  }
  await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [made.categories]);
  for (const id of [...made.categories].reverse()) await pool.query('DELETE FROM categories WHERE id = $1', [id]);
});

// ----------------------------------------------------------------------------
describe('offer rules (catalog.offers)', () => {
  const now = new Date('2026-10-09T06:00:00Z');
  it('a category offer is selling x (1 - percent), only while it runs', () => {
    expect(categoryOfferPrice({ category_offer_percent: '10.00', category_offer_ends_at: null }, 250, now)).toBe(225);
    expect(categoryOfferPrice({ category_offer_percent: 12.5, category_offer_ends_at: '2026-10-10T00:00:00Z' }, 99.99, now)).toBe(87.49);
    expect(categoryOfferPrice({ category_offer_percent: 10, category_offer_ends_at: '2026-10-09T06:00:00Z' }, 250, now)).toBeNull();
    expect(categoryOfferPrice({ category_offer_percent: null }, 250, now)).toBeNull();
    // Less than a cent off is no offer.
    expect(categoryOfferPrice({ category_offer_percent: 1 }, 0.01, now)).toBeNull();
  });

  it('the customer pays the lower of the product offer and the category offer', () => {
    const both = { offer_price: 230, offer_ends_at: null, category_offer_percent: 10, category_offer_ends_at: '2026-10-12T00:00:00Z' };
    expect(bestOffer(both, 250, now)).toEqual({ price: 225, ends_at: '2026-10-12T00:00:00.000Z', kind: 'CATEGORY' });
    expect(bestOffer({ ...both, offer_price: 200 }, 250, now)).toEqual({ price: 200, ends_at: null, kind: 'PRODUCT' });
    // A tie goes to the product's own offer.
    expect(bestOffer({ ...both, offer_price: 225 }, 250, now)?.kind).toBe('PRODUCT');
    expect(bestOffer({ offer_price: null, offer_ends_at: null }, 250, now)).toBeNull();
  });
});

describe('allocateComboPrice', () => {
  const sum = (lines: { quantity: number; unit_price: number }[]) =>
    lines.reduce((s, l) => s + Math.round(l.unit_price * 100) * l.quantity, 0);

  it('shares the price in proportion and adds up to it exactly', () => {
    const lines = allocateComboPrice(500, [
      { unit_price: 250, quantity: 1 },
      { unit_price: 100, quantity: 2 },
      { unit_price: 120, quantity: 1 },
    ]);
    expect(sum(lines)).toBe(50000);
    expect(lines).toHaveLength(3);
    for (const l of lines) expect(l.unit_price).toBeGreaterThan(0);
  });

  it('awkward cents still add up; a unit is split off only when it must be', () => {
    for (const [price, items] of [
      [99.99, [{ unit_price: 33.33, quantity: 1 }, { unit_price: 77.77, quantity: 1 }]],
      [100, [{ unit_price: 60, quantity: 3 }]],
      [100.01, [{ unit_price: 40, quantity: 2 }, { unit_price: 30, quantity: 3 }]],
      [7.77, [{ unit_price: 1.11, quantity: 4 }, { unit_price: 2.22, quantity: 2 }]],
    ] as const) {
      const lines = allocateComboPrice(price, items as never);
      expect(sum(lines), String(price)).toBe(Math.round(price * 100));
      const qty = (idx: number) => lines.filter((l) => l.index === idx).reduce((s, l) => s + l.quantity, 0);
      items.forEach((it, idx) => expect(qty(idx)).toBe(it.quantity));
    }
    // 100.00 over 3 equal units cannot split evenly: one unit carries the cent.
    expect(allocateComboPrice(100, [{ unit_price: 60, quantity: 3 }])).toEqual([
      { index: 0, quantity: 2, unit_price: 33.33 },
      { index: 0, quantity: 1, unit_price: 33.34 },
    ]);
  });
});

// ----------------------------------------------------------------------------
describe('Category offers', () => {
  it('Operations puts a category on offer; its products and its sub-categories show the offer price', async () => {
    const ends = inDays(3);
    const res = await setOffer(parentId, { offer_percent: 10, offer_ends_at: ends });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.category).toMatchObject({ id: parentId, offer_percent: 10, offer_ends_at: ends, offer_active: true });

    expect(await customerView(bakeryBread)).toMatchObject({ selling_price: 250, offer_price: 225, offer_ends_at: ends, offer_kind: 'CATEGORY' });
    // Buns sits inside Bakery: the parent's offer covers it.
    expect(await customerView(bunProduct)).toMatchObject({ selling_price: 100, offer_price: 90, offer_kind: 'CATEGORY' });

    const onOffer = (await request(app).get(`/api/v1/products?on_offer=true&category_id=${parentId}&limit=100`)).body.data.products;
    expect(onOffer.map((p: { id: string }) => p.id).sort()).toEqual([bakeryBread, bunProduct].sort());

    const cats = (await request(app).get('/api/v1/categories')).body.data.categories;
    expect(cats.find((c: { id: string }) => c.id === parentId)).toMatchObject({ offer_percent: 10, offer_ends_at: ends });
    expect(cats.find((c: { id: string }) => c.id === childId)).toMatchObject({ offer_percent: 10 });

    const admin = await adminProduct(bunProduct);
    expect(admin).toMatchObject({ category_offer_percent: 10, customer_price: 90, offer_active: false });

    const audit = (await pool.query(`SELECT action, new_values FROM audit_logs WHERE entity_id = $1 AND action = 'CATEGORY_OFFER_SET'`, [parentId])).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ offer_percent: 10 });
  });

  it('a larger sub-category offer wins over the parent; the lower of product offer and category offer is charged', async () => {
    expect((await setOffer(childId, { offer_percent: 20 })).status).toBe(200);
    expect(await customerView(bunProduct)).toMatchObject({ offer_price: 80, offer_ends_at: null, offer_kind: 'CATEGORY' });

    // Bread's own offer 230 vs category 225 -> 225; own offer 200 -> 200.
    expect((await request(app).patch(`/api/v1/admin/products/${bakeryBread}`).set(auth(tokens.admin)).send({ offer_price: 230 })).status).toBe(200);
    expect(await customerView(bakeryBread)).toMatchObject({ offer_price: 225, offer_kind: 'CATEGORY' });
    expect((await request(app).patch(`/api/v1/admin/products/${bakeryBread}`).set(auth(tokens.admin)).send({ offer_price: 200 })).status).toBe(200);
    expect(await customerView(bakeryBread)).toMatchObject({ offer_price: 200, offer_kind: 'PRODUCT' });

    const order = await placeOrder([
      { product_id: bakeryBread, quantity: 1 },
      { product_id: bunProduct, quantity: 2 },
    ]);
    expect(order.status, JSON.stringify(order.body)).toBe(201);
    const o = order.body.data.order;
    expect(o.subtotal_amount).toBe(200 + 2 * 80);
    expect(o.items.find((i: { product_id: string }) => i.product_id === bunProduct)).toMatchObject({ unit_selling_price: 80, subtotal: 160 });

    expect((await request(app).patch(`/api/v1/admin/products/${bakeryBread}`).set(auth(tokens.admin)).send({ offer_price: null })).status).toBe(200);
  });

  it('refuses 0%, 100%, more than 2 decimals and a past end date; customers cannot set one', async () => {
    expect((await setOffer(parentId, { offer_percent: 0 })).status).toBe(400);
    expect((await setOffer(parentId, { offer_percent: 100 })).status).toBe(400);
    expect((await setOffer(parentId, { offer_percent: 10.555 })).status).toBe(400);
    const past = await setOffer(parentId, { offer_percent: 10, offer_ends_at: inDays(-1) });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('OFFER_END_IN_PAST');
    expect((await setOffer(parentId, { offer_percent: 10 }, tokens.customer)).status).toBe(403);
    await expect(pool.query('UPDATE categories SET offer_percent = 100 WHERE id = $1', [parentId])).rejects.toThrow(/chk_categories_offer_percent/);
  });

  it('an ended offer stops applying; removing the offer clears it', async () => {
    await pool.query("UPDATE categories SET offer_ends_at = now() - interval '1 minute' WHERE id = ANY($1)", [[parentId, childId]]);
    expect(await customerView(bakeryBread)).toMatchObject({ offer_price: null, offer_kind: null });
    const admin = (await request(app).get('/api/v1/admin/categories').set(auth(tokens.admin))).body.data.categories;
    expect(admin.find((c: { id: string }) => c.id === parentId)).toMatchObject({ offer_percent: 10, offer_active: false });

    for (const id of [parentId, childId]) {
      const res = await removeOffer(id);
      expect(res.status).toBe(200);
      expect(res.body.data.category).toMatchObject({ offer_percent: null, offer_ends_at: null, offer_active: false });
    }
    expect(await customerView(bunProduct)).toMatchObject({ offer_price: null });
    const removed = (await pool.query(`SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'CATEGORY_OFFER_REMOVED'`, [parentId])).rows;
    expect(removed).toHaveLength(1);
  });
});

// ----------------------------------------------------------------------------
describe('Combo packs', () => {
  let milk = { productId: '', inventoryId: '' }; // TRACKED, stocked
  let eggs = { productId: '', inventoryId: '' }; // untracked
  let milkSelling = 0;
  let eggSelling = 0;
  let comboId = '';

  const create = (body: object, token = opsToken) => request(app).post('/api/v1/admin/combos').set(auth(token)).send(body);
  const patch = (id: string, body: object) => request(app).patch(`/api/v1/admin/combos/${id}`).set(auth(tokens.admin)).send(body);

  beforeAll(async () => {
    milk = await fx.product({ onHand: 5 });
    eggs = await fx.product({ tracked: false });
    milkSelling = (await adminProduct(milk.productId)).calculated_selling_price;
    eggSelling = (await adminProduct(eggs.productId)).calculated_selling_price;
  });

  it('refuses a combo of one single item, a price not below its items, an unknown product; customers cannot create', async () => {
    const one = await create({ name: `${TAG} One`, price: 10, items: [{ product_id: milk.productId, quantity: 1 }] });
    expect(one.status).toBe(400);
    const dup = await create({ name: `${TAG} Dup`, price: 10, items: [{ product_id: milk.productId, quantity: 1 }, { product_id: milk.productId, quantity: 1 }] });
    expect(dup.status).toBe(400);
    const dear = await create({
      name: `${TAG} Dear`,
      price: round2(milkSelling + 2 * eggSelling),
      items: [{ product_id: milk.productId, quantity: 1 }, { product_id: eggs.productId, quantity: 2 }],
    });
    expect(dear.status).toBe(400);
    expect(dear.body.error.code).toBe('COMBO_PRICE_NOT_LOWER');
    const ghost = await create({
      name: `${TAG} Ghost`,
      price: 10,
      items: [{ product_id: milk.productId, quantity: 1 }, { product_id: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
    });
    expect(ghost.status).toBe(400);
    expect(ghost.body.error.code).toBe('COMBO_PRODUCT_NOT_FOUND');
    expect((await create({ name: `${TAG} X`, price: 10, items: [{ product_id: milk.productId, quantity: 2 }] }, tokens.customer)).status).toBe(403);
  });

  it('Operations creates a combo; customers see it with its items, total and saving - never costs', async () => {
    // 1 milk + 2 eggs, 10 off.
    const itemsTotal = round2(milkSelling + 2 * eggSelling);
    const price = round2(itemsTotal - 10);
    const res = await create({
      name: `${TAG} Breakfast pack`,
      description: 'Milk and eggs',
      price,
      ends_at: inDays(5),
      items: [{ product_id: milk.productId, quantity: 1 }, { product_id: eggs.productId, quantity: 2 }],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    comboId = res.body.data.combo.id;
    made.combos.push(comboId);
    expect(res.body.data.combo).toMatchObject({ price, items_total: itemsTotal, saving: 10, is_live: true, is_available: true, not_live_reason: null });
    expect(JSON.stringify(res.body.data.combo)).not.toContain('purchase_cost');

    const list = await request(app).get('/api/v1/catalog/combos');
    expect(list.status).toBe(200);
    const mine = list.body.data.combos.find((c: { id: string }) => c.id === comboId);
    expect(mine).toMatchObject({ name: `${TAG} Breakfast pack`, price, items_total: itemsTotal, saving: 10, is_available: true });
    expect(mine.items).toHaveLength(2);
    expect(mine.items.find((i: { product_id: string }) => i.product_id === eggs.productId)).toMatchObject({ quantity: 2, unit_price: eggSelling });
    const json = JSON.stringify(mine);
    for (const key of ['purchase_cost', 'effective_markup_percent', 'stock_available', 'not_live_reason']) expect(json).not.toContain(key);
    expect((await request(app).get(`/api/v1/combos/${comboId}`)).body.data.combo.id).toBe(comboId);

    const audit = (await pool.query(`SELECT 1 FROM audit_logs WHERE entity_id = $1 AND action = 'COMBO_CREATED'`, [comboId])).rows;
    expect(audit).toHaveLength(1);
  });

  it('the order charges the combo price; its items share it and point at the combo line', async () => {
    const combo = (await request(app).get(`/api/v1/combos/${comboId}`)).body.data.combo;
    const res = await placeOrder([{ product_id: eggs.productId, quantity: 1 }], [{ combo_id: comboId, quantity: 2 }]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const order = res.body.data.order;
    expect(order.subtotal_amount).toBe(round2(2 * combo.price + eggSelling));
    expect(order.combos).toHaveLength(1);
    expect(order.combos[0]).toMatchObject({ combo_id: comboId, name: combo.name, unit_price: combo.price, quantity: 2, subtotal: round2(2 * combo.price), items_regular_total: combo.items_total });

    const comboItems = order.items.filter((i: { order_combo_id: string | null }) => i.order_combo_id === order.combos[0].id);
    const loose = order.items.filter((i: { order_combo_id: string | null }) => i.order_combo_id === null);
    expect(loose).toEqual([expect.objectContaining({ product_id: eggs.productId, quantity: 1, unit_selling_price: eggSelling })]);
    const qty = (p: string) => comboItems.filter((i: { product_id: string }) => i.product_id === p).reduce((s: number, i: { quantity: number }) => s + i.quantity, 0);
    expect(qty(milk.productId)).toBe(2);
    expect(qty(eggs.productId)).toBe(4);
    const cents = comboItems.reduce((s: number, i: { subtotal: number }) => s + Math.round(i.subtotal * 100), 0);
    expect(cents).toBe(Math.round(2 * combo.price * 100));

    // The detail (customer and staff) carries the combo lines too.
    const detail = (await request(app).get(`/api/v1/orders/${order.id}`).set(auth(tokens.customer))).body.data.order;
    expect(detail.combos).toHaveLength(1);
    const staff = (await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(opsToken))).body.data.order;
    expect(staff.combos[0].name).toBe(combo.name);
    expect(staff.items.filter((i: { order_combo_id: string | null }) => i.order_combo_id).length).toBeGreaterThanOrEqual(2);

    // Packing takes the tracked stock for the combo's milk (2 packs).
    expect(await fx.onHand(milk)).toBe(5);
    expect((await fx.pack(order.id)).status).toBe(200);
    expect(await fx.onHand(milk)).toBe(3);

    // The rider's bag list names the combo for its items.
    const rider = await fx.tempRider('combo');
    const assigned = await fx.assign(order.id, rider.riderId);
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    const bag = (await riderRepository.findDeliveryById(assigned.body.data.delivery.id))!.items as Array<Record<string, unknown>>;
    const milkLine = bag.find((i) => i.combo_name === combo.name);
    expect(milkLine).toMatchObject({ combo_quantity: 2 });
    const looseLine = bag.find((i) => !('combo_name' in i));
    expect(looseLine).toMatchObject({ quantity: 1 });
  });

  it('is unavailable without enough tracked stock, and the order is refused', async () => {
    // 3 milk left; 4 packs need 4.
    const res = await placeOrder([], [{ combo_id: comboId, quantity: 4 }]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COMBO_OUT_OF_STOCK');

    await fx.adjust(milk.productId, 'DAMAGE_WRITE_OFF', -3);
    const view = (await request(app).get(`/api/v1/combos/${comboId}`)).body.data.combo;
    expect(view.is_available).toBe(false);
    expect((await placeOrder([], [{ combo_id: comboId, quantity: 1 }])).status).toBe(409);
    await fx.adjust(milk.productId, 'PURCHASE_RESTOCK', 3);
  });

  it('a switched-off, ended or no-longer-cheaper combo is hidden and cannot be ordered', async () => {
    expect((await patch(comboId, { is_active: false })).status).toBe(200);
    expect((await request(app).get(`/api/v1/combos/${comboId}`)).status).toBe(404);
    const off = await placeOrder([], [{ combo_id: comboId, quantity: 1 }]);
    expect(off.status).toBe(400);
    expect(off.body.error.code).toBe('COMBO_UNAVAILABLE');
    expect((await patch(comboId, { is_active: true })).status).toBe(200);

    await pool.query("UPDATE combos SET ends_at = now() - interval '1 minute' WHERE id = $1", [comboId]);
    const admin = (await request(app).get(`/api/v1/admin/combos/${comboId}`).set(auth(tokens.admin))).body.data.combo;
    expect(admin).toMatchObject({ is_live: false, not_live_reason: 'ENDED' });
    expect((await request(app).get('/api/v1/catalog/combos')).body.data.combos.map((c: { id: string }) => c.id)).not.toContain(comboId);
    expect((await patch(comboId, { ends_at: null })).status).toBe(200);

    // Eggs go on a deep offer: the items are now cheaper than the combo.
    expect((await request(app).patch(`/api/v1/admin/products/${eggs.productId}`).set(auth(tokens.admin)).send({ offer_price: 1 })).status).toBe(200);
    const dear = (await request(app).get(`/api/v1/admin/combos/${comboId}`).set(auth(tokens.admin))).body.data.combo;
    expect(dear.not_live_reason).toBe('NOT_CHEAPER');
    expect((await placeOrder([], [{ combo_id: comboId, quantity: 1 }])).body.error.code).toBe('COMBO_UNAVAILABLE');
    expect((await request(app).patch(`/api/v1/admin/products/${eggs.productId}`).set(auth(tokens.admin)).send({ offer_price: null })).status).toBe(200);
  });

  it('editing replaces the items; deleting hides it but keeps it for order history', async () => {
    const items = [{ product_id: milk.productId, quantity: 3 }];
    const price = round2(3 * milkSelling - 5);
    const res = await patch(comboId, { items, price, name: `${TAG} Milk trio` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.combo.items).toHaveLength(1);
    expect(res.body.data.combo).toMatchObject({ name: `${TAG} Milk trio`, price, saving: 5 });

    const del = await request(app).delete(`/api/v1/admin/combos/${comboId}`).set(auth(opsToken));
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/v1/admin/combos/${comboId}`).set(auth(tokens.admin))).status).toBe(404);
    expect((await pool.query('SELECT deleted_at FROM combos WHERE id = $1', [comboId])).rows[0].deleted_at).not.toBeNull();
    const history = (await pool.query('SELECT combo_id FROM order_combos WHERE combo_id = $1', [comboId])).rows;
    expect(history.length).toBeGreaterThan(0);
  });

  it('old clients without combos still order; an empty cart is still refused', async () => {
    const ok = await placeOrder([{ product_id: eggs.productId, quantity: 1 }]);
    expect(ok.status).toBe(201);
    expect(ok.body.data.order.combos).toEqual([]);
    const empty = await placeOrder([]);
    expect(empty.status).toBe(400);
  });
});
