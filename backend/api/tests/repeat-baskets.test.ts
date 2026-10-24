import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { setRepeatBasketsReadyForTests } from '../src/modules/repeat-baskets/repeat.ready.js';
import { stockFixtures, tokens, auth } from './helpers/stock.js';
import { customerFixtures, expectCreated } from './helpers/customers.js';

/**
 * Repeat baskets API (migration 054; contract 2026-10-24-buy-again-repeat.md
 * section 2): the customer's CRUD, limits and validation, "from order", the
 * staff list / patch, repeat_basket_id on order DTOs, and the 503 guard
 * before 054. The ordering clock is pinned to Tue 2026-10-06 12:00 Colombo
 * (06:30 UTC) and the store hours to 08:00 - 21:00 every day (tests/setup).
 */
const app = createApp();
const fx = stockFixtures(app, 'TST-RPB-');
const people = customerFixtures(app, { idPrefix: 'c0c00054', phoneBase: '+947095400', name: 'Repeat Basket Customer' });
let p1 = '';
let p2 = '';
let p3 = '';
const basketIds: string[] = [];

const B = '/api/v1/me/repeat-baskets';
const create = (token: string, body: object) => request(app).post(B).set(auth(token)).send(body);
const list = async (token: string) => {
  const res = await request(app).get(B).set(auth(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.baskets as Array<Record<string, any>>;
};
async function created(res: request.Response) {
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  basketIds.push(res.body.data.basket.id);
  return res.body.data.basket as Record<string, any>;
}
const issuePath = (res: request.Response) => (res.body.error?.details ?? res.body.details ?? []).map((d: { path: unknown[] }) => d.path.join('.'));

beforeAll(async () => {
  await people.purge();
  await fx.setup();
  p1 = (await fx.product({ tracked: false })).productId;
  p2 = (await fx.product({ tracked: false })).productId;
  p3 = (await fx.product({ tracked: false })).productId;
});

afterAll(async () => {
  setRepeatBasketsReadyForTests(null);
  if (basketIds.length) await pool.query(`DELETE FROM audit_logs WHERE entity_type = 'repeat_basket' AND entity_id = ANY($1)`, [basketIds]);
  await people.cleanup();
  await fx.cleanup();
});

describe('before migration 054', () => {
  it('every repeat-basket route answers 503 REPEAT_NOT_READY and GET /store says false', async () => {
    const me = await people.customer(1);
    setRepeatBasketsReadyForTests(false);
    try {
      const r1 = await request(app).get(B).set(auth(me.token));
      expect(r1.status).toBe(503);
      expect(r1.body.error?.code ?? r1.body.code).toBe('REPEAT_NOT_READY');
      expect((await create(me.token, {})).status).toBe(503);
      expect((await request(app).get('/api/v1/admin/repeat-baskets').set(auth(tokens.admin))).status).toBe(503);
      const store = await request(app).get('/api/v1/store');
      expect(store.status).toBe(200);
      expect(store.body.data.repeat_baskets_enabled).toBe(false);
      // Buy again needs no migration.
      expect((await request(app).get('/api/v1/me/buy-again').set(auth(me.token))).status).toBe(200);
    } finally {
      setRepeatBasketsReadyForTests(null);
    }
    expect((await request(app).get('/api/v1/store')).body.data.repeat_baskets_enabled).toBe(true);
  });
});

describe('customer repeat baskets', () => {
  it('creates a basket with its next run, estimate and no last run', async () => {
    const me = await people.customer(2);
    const basket = await created(
      await create(me.token, {
        items: [
          { product_id: p1, quantity: 2 },
          { product_id: p2, variant_id: null, quantity: 1 },
        ],
        frequency: 'DAILY',
        weekday: 3, // ignored for DAILY
        place_at: '10:00',
        address_id: me.addressId,
        notes: 'Leave at the gate',
      })
    );
    expect(basket).toMatchObject({
      name: 'My basket',
      frequency: 'DAILY',
      weekday: null,
      place_at: '10:00',
      address_id: me.addressId,
      notes: 'Leave at the gate',
      status: 'ACTIVE',
      skip_next: false,
      last_run: null,
      start_date: null,
      items: [
        { product_id: p1, variant_id: null, quantity: 2 },
        { product_id: p2, variant_id: null, quantity: 1 },
      ],
    });
    // 12:00 Colombo now: 10:00 today has passed -> tomorrow 10:00 Colombo (04:30 UTC).
    expect(basket.next_run_at).toBe('2026-10-07T04:30:00.000Z');
    expect(basket.estimate).toMatchObject({ available_lines: 2, unavailable_lines: 0 });
    expect(basket.estimate.items_total).toBeGreaterThan(0);

    const weekly = await created(
      await create(me.token, {
        name: 'Monday shop',
        items: [{ product_id: p3, quantity: 1 }],
        frequency: 'WEEKLY',
        weekday: 1,
        place_at: '09:00',
        address_id: me.addressId,
      })
    );
    expect(weekly.next_run_at).toBe('2026-10-12T03:30:00.000Z'); // Mon 09:00 Colombo
    const later = await created(
      await create(me.token, {
        items: [{ product_id: p3, quantity: 1 }],
        frequency: 'BIWEEKLY',
        weekday: 2,
        place_at: '18:00',
        address_id: me.addressId,
        start_date: '2026-10-20',
      })
    );
    expect(later).toMatchObject({ start_date: '2026-10-20', next_run_at: '2026-10-20T12:30:00.000Z' });
    // Today, when today's time is still ahead.
    const today = await created(
      await create(me.token, { items: [{ product_id: p1, quantity: 1 }], frequency: 'WEEKLY', weekday: 2, place_at: '15:15', address_id: me.addressId })
    );
    expect(today.next_run_at).toBe('2026-10-06T09:45:00.000Z');

    const mine = await list(me.token);
    expect(mine.map((b) => b.id)).toEqual([basket.id, weekly.id, later.id, today.id]);
    expect(mine[0].estimate.items_total).toBe(basket.estimate.items_total);
  });

  it('validates the fields (400 VALIDATION_ERROR naming the field)', async () => {
    const me = await people.customer(3);
    const other = await people.customer(4);
    const ok = { items: [{ product_id: p1, quantity: 1 }], frequency: 'WEEKLY', weekday: 5, place_at: '10:00', address_id: me.addressId };
    const bad = async (body: object, path: string) => {
      const res = await create(me.token, body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.error?.code ?? res.body.code).toBe('VALIDATION_ERROR');
      expect(issuePath(res)).toContain(path);
    };
    await bad({ ...ok, items: [] }, 'items');
    await bad({ ...ok, weekday: undefined }, 'weekday');
    await bad({ ...ok, weekday: 7 }, 'weekday');
    await bad({ ...ok, frequency: 'MONTHLY' }, 'frequency');
    await bad({ ...ok, place_at: '9:00' }, 'place_at');
    await bad({ ...ok, name: 'x'.repeat(41) }, 'name');
    await bad({ ...ok, notes: 'x'.repeat(301) }, 'notes');
    await bad({ ...ok, items: [{ product_id: p1, quantity: 21 }] }, 'items.0.quantity');
    await bad({ ...ok, items: [{ product_id: p1, quantity: 1 }, { product_id: p1, quantity: 2 }] }, 'items.1');
    await bad({ ...ok, items: Array.from({ length: 31 }, () => ({ product_id: randomUUID(), quantity: 1 })) }, 'items');
    await bad({ ...ok, items: [{ product_id: randomUUID(), quantity: 1 }] }, 'items.0.product_id');
    await bad({ ...ok, items: [{ product_id: p1, variant_id: randomUUID(), quantity: 1 }] }, 'items.0.variant_id');
    await bad({ ...ok, address_id: other.addressId }, 'address_id');
    await bad({ ...ok, start_date: '2026-13-01' }, 'start_date');
    expect(await list(me.token)).toEqual([]);
  });

  it('place_at must be inside the opening hours (400 PLACE_AT_OUTSIDE_HOURS)', async () => {
    const me = await people.customer(5);
    const body = { items: [{ product_id: p1, quantity: 1 }], frequency: 'DAILY', address_id: me.addressId };
    for (const place_at of ['07:45', '21:00', '23:30']) {
      const res = await create(me.token, { ...body, place_at });
      expect(res.status, place_at).toBe(400);
      expect(res.body.error?.code ?? res.body.code).toBe('PLACE_AT_OUTSIDE_HOURS');
    }
    await created(await create(me.token, { ...body, place_at: '08:00' }));
    await created(await create(me.token, { ...body, place_at: '20:45' }));
  });

  it('at most 5 baskets that are not cancelled (409 BASKET_LIMIT)', async () => {
    const me = await people.customer(6);
    const body = { items: [{ product_id: p1, quantity: 1 }], frequency: 'DAILY', place_at: '12:30', address_id: me.addressId };
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await created(await create(me.token, { ...body, name: `Basket ${i + 1}` })));
    const sixth = await create(me.token, body);
    expect(sixth.status).toBe(409);
    expect(sixth.body.error?.code ?? sixth.body.code).toBe('BASKET_LIMIT');
    // Cancelling one frees a place; the cancelled one is no longer listed.
    const del = await request(app).delete(`${B}/${made[0].id}`).set(auth(me.token));
    expect(del.status).toBe(200);
    expect(del.body.data.basket).toMatchObject({ status: 'CANCELLED', next_run_at: null });
    await created(await create(me.token, body));
    const mine = await list(me.token);
    expect(mine).toHaveLength(5);
    expect(mine.map((b) => b.id)).not.toContain(made[0].id);
    // A cancelled basket cannot be changed any more.
    expect((await request(app).patch(`${B}/${made[0].id}`).set(auth(me.token)).send({ name: 'Back' })).status).toBe(404);
  });

  it('PATCH changes fields; next_run_at follows the schedule and status; skip-next toggles', async () => {
    const me = await people.customer(7);
    const other = await people.customer(8);
    const basket = await created(
      await create(me.token, { items: [{ product_id: p1, quantity: 1 }], frequency: 'DAILY', place_at: '10:00', address_id: me.addressId })
    );
    const patch = (body: object, token = me.token) => request(app).patch(`${B}/${basket.id}`).set(auth(token)).send(body);

    let res = await patch({ name: 'Milk and bread', items: [{ product_id: p2, quantity: 3 }], notes: null });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.basket).toMatchObject({
      name: 'Milk and bread',
      items: [{ product_id: p2, variant_id: null, quantity: 3 }],
      notes: null,
      next_run_at: basket.next_run_at,
    });

    res = await patch({ frequency: 'WEEKLY', weekday: 0, place_at: '11:30' });
    expect(res.body.data.basket).toMatchObject({ frequency: 'WEEKLY', weekday: 0, next_run_at: '2026-10-11T06:00:00.000Z' });

    res = await patch({ status: 'PAUSED' });
    expect(res.body.data.basket).toMatchObject({ status: 'PAUSED', next_run_at: null });
    res = await patch({ status: 'ACTIVE' });
    expect(res.body.data.basket).toMatchObject({ status: 'ACTIVE', next_run_at: '2026-10-11T06:00:00.000Z' });

    res = await patch({ frequency: 'DAILY' });
    expect(res.body.data.basket).toMatchObject({ frequency: 'DAILY', weekday: null, next_run_at: '2026-10-07T06:00:00.000Z' });
    // Back to weekly needs a weekday.
    res = await patch({ frequency: 'BIWEEKLY' });
    expect(res.status).toBe(400);
    expect(issuePath(res)).toContain('weekday');
    expect((await patch({ place_at: '06:00' })).body.error?.code ?? 'x').toBe('PLACE_AT_OUTSIDE_HOURS');
    expect((await patch({})).status).toBe(400);

    // Another customer's basket does not exist for them.
    res = await patch({ name: 'Mine now' }, other.token);
    expect(res.status).toBe(404);
    expect(res.body.error?.code ?? res.body.code).toBe('BASKET_NOT_FOUND');
    expect((await request(app).delete(`${B}/${basket.id}`).set(auth(other.token))).status).toBe(404);

    res = await request(app).post(`${B}/${basket.id}/skip-next`).set(auth(me.token));
    expect(res.status).toBe(200);
    expect(res.body.data.basket.skip_next).toBe(true);
    res = await request(app).post(`${B}/${basket.id}/skip-next`).set(auth(me.token));
    expect(res.body.data.basket.skip_next).toBe(false);
  });

  it('from an order: its kept loose lines and the address it went to', async () => {
    const me = await people.customer(9);
    const other = await people.customer(10);
    const second = (
      await pool.query(
        `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
         VALUES ($1, 'Work', 'Work', $2, 'No. 9, Office Road', 'Dharga Town', 6.4352, 80.0244, false) RETURNING id`,
        [me.id, me.phone]
      )
    ).rows[0].id as string;
    const order = await expectCreated(
      await request(app)
        .post('/api/v1/orders')
        .set(auth(me.token))
        .send({
          address_id: second,
          items: [
            { product_id: p1, quantity: 2 },
            { product_id: p2, quantity: 1 },
            { product_id: p3, quantity: 25 },
          ],
        })
    );
    await pool.query(`UPDATE order_items SET item_status = 'UNAVAILABLE' WHERE order_id = $1 AND product_id = $2`, [order.id, p2]);
    const res = await request(app)
      .post(`${B}/from-order/${order.id}`)
      .set(auth(me.token))
      .send({ frequency: 'WEEKLY', weekday: 6, place_at: '08:30', name: 'Saturday' });
    const basket = await created(res);
    expect(basket).toMatchObject({
      name: 'Saturday',
      address_id: second,
      frequency: 'WEEKLY',
      weekday: 6,
      next_run_at: '2026-10-10T03:00:00.000Z',
    });
    // The lines of one order share a timestamp, so their order is not fixed.
    expect(basket.items).toHaveLength(2);
    expect(basket.items).toEqual(
      expect.arrayContaining([
        { product_id: p1, variant_id: null, quantity: 2 },
        { product_id: p3, variant_id: null, quantity: 20 },
      ])
    );
    // Someone else's order: 404.
    const nope = await request(app).post(`${B}/from-order/${order.id}`).set(auth(other.token)).send({ frequency: 'DAILY', place_at: '09:00' });
    expect(nope.status).toBe(404);
    expect(nope.body.error?.code ?? nope.body.code).toBe('ORDER_NOT_FOUND');

    // Ordinary orders say repeat_basket_id null (customer and staff).
    const mineOrder = await request(app).get(`/api/v1/orders/${order.id}`).set(auth(me.token));
    expect(mineOrder.body.data.order).toHaveProperty('repeat_basket_id', null);
    const staffOrder = await request(app).get(`/api/v1/admin/orders/${order.id}`).set(auth(tokens.admin));
    expect(staffOrder.status).toBe(200);
    expect(staffOrder.body.data.order).toHaveProperty('repeat_basket_id', null);
  });

  it('needs a signed-in shopper', async () => {
    expect((await request(app).get(B)).status).toBe(401);
    expect((await request(app).get(B).set(auth(tokens.admin))).status).toBe(403);
  });
});

describe('staff repeat baskets', () => {
  it('lists with customer, items count and schedule; pause / resume / cancel (audited)', async () => {
    const me = await people.customer(11, 'Repeat Staff View');
    const basket = await created(
      await create(me.token, {
        items: [
          { product_id: p1, quantity: 1 },
          { product_id: p2, quantity: 1 },
        ],
        frequency: 'WEEKLY',
        weekday: 4,
        place_at: '16:00',
        address_id: me.addressId,
      })
    );
    const res = await request(app).get('/api/v1/admin/repeat-baskets?status=ACTIVE&limit=200').set(auth(tokens.admin));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const row = res.body.data.baskets.find((b: { id: string }) => b.id === basket.id);
    expect(row).toMatchObject({
      status: 'ACTIVE',
      frequency: 'WEEKLY',
      weekday: 4,
      place_at: '16:00',
      items_count: 2,
      next_run_at: basket.next_run_at,
      last_run: null,
      customer: { id: me.id, full_name: 'Repeat Staff View', phone: me.phone },
    });
    expect(res.body.data.pagination).toMatchObject({ page: 1, limit: 200 });

    const patch = (status: string, token = tokens.admin) =>
      request(app).patch(`/api/v1/admin/repeat-baskets/${basket.id}`).set(auth(token)).send({ status });
    let r = await patch('PAUSED');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.basket).toMatchObject({ id: basket.id, status: 'PAUSED', next_run_at: null });
    r = await patch('ACTIVE');
    expect(r.body.data.basket).toMatchObject({ status: 'ACTIVE', next_run_at: basket.next_run_at });
    r = await patch('CANCELLED');
    expect(r.body.data.basket.status).toBe('CANCELLED');
    r = await patch('ACTIVE');
    expect(r.status).toBe(409);
    expect(r.body.error?.code ?? r.body.code).toBe('BASKET_CANCELLED');
    expect((await patch('DELETED')).status).toBe(400);

    const audits = await pool.query(
      `SELECT new_values FROM audit_logs WHERE action = 'REPEAT_BASKET_UPDATED' AND entity_id = $1 ORDER BY created_at`,
      [basket.id]
    );
    expect(audits.rows.map((a) => (typeof a.new_values === 'string' ? JSON.parse(a.new_values) : a.new_values).status)).toEqual([
      'PAUSED',
      'ACTIVE',
      'CANCELLED',
    ]);

    // Customers and other roles cannot use the staff routes; unknown basket -> 404.
    expect((await request(app).get('/api/v1/admin/repeat-baskets').set(auth(me.token))).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/repeat-baskets').set(auth(tokens.staff))).status).toBe(403);
    const missing = await request(app).patch(`/api/v1/admin/repeat-baskets/${randomUUID()}`).set(auth(tokens.admin)).send({ status: 'PAUSED' });
    expect(missing.status).toBe(404);
  });
});
