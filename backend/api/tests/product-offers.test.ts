import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { activeOfferPrice } from '../src/modules/catalog/catalog.offers.js';
import { stockFixtures, tokens, auth, users } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Product offers (migration 031; owner, 2026-10-09): Operations and Admin put
 * a product on offer at a reduced price, optionally until a date. Customers
 * see offer_price next to the regular selling_price; the cart and the order
 * charge the offer price. Products and orders made here are removed after.
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-OFFER-');
const people = customerFixtures(app, { idPrefix: 'c0c00031', phoneBase: '+947093100', name: 'Offer Customer' });
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });

let productId = '';
let selling = 0;

const edit = (body: object, token = tokens.admin, id = productId) =>
  request(app).patch(`/api/v1/admin/products/${id}`).set(auth(token)).send(body);
const customerView = async (id = productId) => (await request(app).get(`/api/v1/products/${id}`)).body.data.product;
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  productId = (await fx.product({ tracked: false })).productId;
  const admin = await request(app).get(`/api/v1/admin/products/${productId}`).set(auth(tokens.admin));
  selling = admin.body.data.product.calculated_selling_price;
  expect(selling).toBeGreaterThan(10);
});

afterAll(async () => {
  await people.cleanup();
  await fx.cleanup();
});

describe('activeOfferPrice', () => {
  const now = new Date('2026-10-09T06:00:00Z');
  it('applies only while set, not ended, and below the selling price', () => {
    expect(activeOfferPrice({ offer_price: null, offer_ends_at: null }, 250, now)).toBeNull();
    expect(activeOfferPrice({ offer_price: '220.00', offer_ends_at: null }, 250, now)).toBe(220);
    expect(activeOfferPrice({ offer_price: 220, offer_ends_at: '2026-10-10T00:00:00Z' }, 250, now)).toBe(220);
    expect(activeOfferPrice({ offer_price: 220, offer_ends_at: '2026-10-09T06:00:00Z' }, 250, now)).toBeNull();
    expect(activeOfferPrice({ offer_price: 250, offer_ends_at: null }, 250, now)).toBeNull();
  });
});

describe('Putting a product on offer', () => {
  it('Operations sets an offer; customers see it next to the regular price', async () => {
    const offer = Number((selling - 10).toFixed(2));
    const ends = inDays(3);
    const res = await edit({ offer_price: offer, offer_ends_at: ends }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.product).toMatchObject({ offer_price: offer, offer_ends_at: ends, offer_active: true });

    expect(await customerView()).toMatchObject({ selling_price: selling, offer_price: offer, offer_ends_at: ends });

    const list = await request(app).get('/api/v1/products?on_offer=true&limit=100');
    expect(list.status).toBe(200);
    const ids = list.body.data.products.map((p: { id: string }) => p.id);
    expect(ids).toContain(productId);
    for (const p of list.body.data.products) expect(p.offer_price).not.toBeNull();
  });

  it('refuses an offer that is not lower than the selling price, or a past end date', async () => {
    const same = await edit({ offer_price: selling });
    expect(same.status).toBe(400);
    expect(same.body.error.code).toBe('OFFER_PRICE_NOT_LOWER');
    expect((await edit({ offer_price: 0 })).status).toBe(400);
    expect((await edit({ offer_price: 10.555 })).status).toBe(400);
    const past = await edit({ offer_price: 5, offer_ends_at: inDays(-1) });
    expect(past.status).toBe(400);
    expect(past.body.error.code).toBe('OFFER_END_IN_PAST');
    // A cost rise that would put the regular price at or under the offer.
    const cost = await edit({ purchase_cost: 1, custom_markup_percent: 0 });
    expect(cost.status).toBe(400);
    expect(cost.body.error.code).toBe('OFFER_PRICE_NOT_LOWER');
  });

  it('the cart and the order charge the offer price; the item snapshot keeps it', async () => {
    const offer = Number((selling - 10).toFixed(2));
    const me = await people.customer(1);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 2 }]));
    expect(order.subtotal_amount).toBe(Number((offer * 2).toFixed(2)));
    const item = order.items.find((i: { product_id: string }) => i.product_id === productId);
    expect(item).toMatchObject({ unit_selling_price: offer, quantity: 2, subtotal: Number((offer * 2).toFixed(2)) });
  });

  it('an ended offer stops applying: regular price shown and charged', async () => {
    await pool.query("UPDATE products SET offer_ends_at = now() - interval '1 minute' WHERE id = $1", [productId]);
    expect(await customerView()).toMatchObject({ selling_price: selling, offer_price: null, offer_ends_at: null });
    const admin = (await request(app).get(`/api/v1/admin/products/${productId}`).set(auth(tokens.admin))).body.data.product;
    expect(admin.offer_active).toBe(false);
    expect(admin.offer_price).not.toBeNull();

    const onOffer = (await request(app).get('/api/v1/products?on_offer=true&limit=100')).body.data.products;
    expect(onOffer.map((p: { id: string }) => p.id)).not.toContain(productId);

    const me = await people.customer(2);
    const order = await expectCreated(await me.placeOrder([{ product_id: productId, quantity: 1 }]));
    expect(order.subtotal_amount).toBe(selling);

    // The form sends the ended date back unchanged with other edits: allowed.
    const resend = await edit({ name: `Offer resend ${Date.now()}`, offer_price: admin.offer_price, offer_ends_at: admin.offer_ends_at });
    expect(resend.status, JSON.stringify(resend.body)).toBe(200);
  });

  it('removing the offer clears its end date too; an offer without an end date runs on', async () => {
    const removed = await edit({ offer_price: null });
    expect(removed.status).toBe(200);
    expect(removed.body.data.product).toMatchObject({ offer_price: null, offer_ends_at: null, offer_active: false });

    const open = await edit({ offer_price: 5 });
    expect(open.status).toBe(200);
    expect(open.body.data.product).toMatchObject({ offer_price: 5, offer_ends_at: null, offer_active: true });
    expect(await customerView()).toMatchObject({ offer_price: 5, offer_ends_at: null });
    expect((await edit({ offer_price: null })).status).toBe(200);
  });

  it('can be set when the product is created; the database refuses a zero offer', async () => {
    const category = (await request(app).get(`/api/v1/admin/products/${productId}`).set(auth(tokens.admin))).body.data.product.category_id;
    const res = await request(app)
      .post('/api/v1/admin/products')
      .set(auth(tokens.admin))
      .send({ category_id: category, name: `Offer new ${Date.now()}`, sku: `TST-OFFER-N-${Date.now()}`, unit: '1 kg', purchase_cost: 200, custom_markup_percent: 25, offer_price: 220 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.data.product.id;
    try {
      expect(res.body.data.product).toMatchObject({ calculated_selling_price: 250, offer_price: 220, offer_active: true });
      await expect(pool.query('UPDATE products SET offer_price = 0 WHERE id = $1', [id])).rejects.toThrow(/chk_products_offer_price_positive/);
    } finally {
      await pool.query('DELETE FROM inventory WHERE product_id = $1', [id]);
      await pool.query('DELETE FROM products WHERE id = $1', [id]);
    }
  });

  it('customers cannot set an offer', async () => {
    expect((await edit({ offer_price: 1 }, tokens.customer)).status).toBe(403);
  });
});
