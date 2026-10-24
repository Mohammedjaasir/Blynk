import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { tokens, auth, users } from './helpers/stock.js';
import { sellerFixtures } from './helpers/seller-fixtures.js';

/**
 * Seller portal, staff side (docs/superpowers/plans/2026-10-24-seller-portal.md): approving /
 * rejecting / suspending sellers, and approving / rejecting what they submit - a NEW product (which
 * becomes a live customer product with the seller's price as its cost and "Sold by") or an EDIT of a
 * live one. Submissions are inserted the way the seller API stores them.
 */
const app = createApp();
const fx = sellerFixtures('appr');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const A = '/api/v1/admin';

const getSellers = (qs = '', token = tokens.admin) => request(app).get(`${A}/sellers${qs}`).set(auth(token));
const patchSeller = (id: string, body: unknown, token = tokens.admin) => request(app).patch(`${A}/sellers/${id}`).set(auth(token)).send(body as object);
const getSubs = (qs = '', token = tokens.admin) => request(app).get(`${A}/seller-submissions${qs}`).set(auth(token));
const approve = (id: string, body: unknown = {}, token = tokens.admin) =>
  request(app).post(`${A}/seller-submissions/${id}/approve`).set(auth(token)).send(body as object);
const reject = (id: string, body: unknown, token = tokens.admin) =>
  request(app).post(`${A}/seller-submissions/${id}/reject`).set(auth(token)).send(body as object);
const customerProduct = (id: string) => request(app).get(`/api/v1/products/${id}`);

beforeAll(fx.setup);
afterAll(fx.cleanup);

/** A live product of the seller, as an earlier NEW approval left it. */
async function liveProduct(sellerId: string, price = 80, selling = 100) {
  const subId = await fx.submission(sellerId, { price });
  const res = await approve(subId, { selling_price: selling });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data.product as { id: string; slug: string; sku: string };
}

describe('Seller staff API: access', () => {
  it('is for Admin and Operations only', async () => {
    const s = await fx.seller();
    const sub = await fx.submission(s.id);
    const customer = tokens.customer;
    for (const token of [customer, s.token, tokens.rider, tokens.staff]) {
      expect((await getSellers('', token)).status).toBe(403);
      expect((await getSubs('', token)).status).toBe(403);
      expect((await patchSeller(s.id, { commission_percent: 5 }, token)).status).toBe(403);
      expect((await approve(sub, { selling_price: 100 }, token)).status).toBe(403);
      expect((await reject(sub, { reason: 'no thanks' }, token)).status).toBe(403);
      expect((await request(app).post(`${A}/sellers/${s.id}/payouts`).set(auth(token)).send({ amount: 10 })).status).toBe(403);
    }
    expect((await request(app).get(`${A}/sellers`)).status).toBe(401);
    expect((await getSellers('', opsToken)).status).toBe(200);
    expect((await getSubs('', opsToken)).status).toBe(200);
    // nothing changed
    expect((await fx.row('SELECT status FROM seller_submissions WHERE id = $1', [sub])).status).toBe('PENDING');
  });

  it('does not disturb the other /admin routes', async () => {
    const res = await request(app).get(`${A}/products`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect((await request(app).get(`${A}/products`).set(auth(tokens.customer))).status).toBe(403);
  });
});

describe('Seller list and detail', () => {
  it('lists sellers with phone, counts and due; filters by status and search; pending first', async () => {
    const p = await fx.seller({ status: 'PENDING', shop: `Findable Pending ${fx.stamp}` });
    const a = await fx.seller({ status: 'APPROVED', shop: `Findable Approved ${fx.stamp}`, commission: 12.5 });
    const all = await getSellers(`?search=Findable%20%25${fx.stamp}`);
    expect(all.status).toBe(200);
    expect(all.body.data.sellers).toHaveLength(0); // a literal % in the search is not a wildcard

    const found = await getSellers(`?search=Findable`);
    const mine = (found.body.data.sellers as { id: string }[]).filter((s) => [p.id, a.id].includes(s.id));
    expect(mine.map((s) => s.id)).toEqual([p.id, a.id]); // PENDING first
    expect(mine[1]).toMatchObject({
      id: a.id,
      shop_name: a.shop,
      status: 'APPROVED',
      commission_percent: 12.5,
      phone: a.phone,
      full_name: expect.any(String),
      products_live: 0,
      submissions_pending: 0,
      due: 0,
      rejection_reason: null,
    });

    const byPhone = await getSellers(`?search=${encodeURIComponent(a.phone)}`);
    expect(byPhone.body.data.sellers.map((s: { id: string }) => s.id)).toEqual([a.id]);
    const pending = await getSellers('?status=PENDING&search=Findable');
    expect(pending.body.data.sellers.map((s: { id: string }) => s.id)).toEqual([p.id]);
    expect((await getSellers('?status=NOPE')).status).toBe(400);
  });

  it('GET /sellers/:id gives the seller and the statement; 404 / 400 for bad ids', async () => {
    const s = await fx.seller({ commission: 10 });
    const res = await request(app).get(`${A}/sellers/${s.id}`).set(auth(tokens.admin));
    expect(res.status).toBe(200);
    expect(res.body.data.seller).toMatchObject({ id: s.id, shop_name: s.shop, phone: s.phone, due: 0 });
    expect(res.body.data.statement).toMatchObject({ commission_percent: 10, gross: 0, commission: 0, earned: 0, paid: 0, due: 0, lines: [], payouts: [] });
    expect((await request(app).get(`${A}/sellers/00000000-0000-4000-8000-000000000999`).set(auth(tokens.admin))).status).toBe(404);
    expect((await request(app).get(`${A}/sellers/nope`).set(auth(tokens.admin))).status).toBe(400);
    expect((await request(app).get(`${A}/sellers/${s.id}?from=2026-13-40`).set(auth(tokens.admin))).status).toBe(400);
  });
});

describe('Approving, rejecting and suspending a seller', () => {
  it('approving a pending seller: status, reviewer, SMS, audit', async () => {
    const s = await fx.seller({ status: 'PENDING' });
    const res = await patchSeller(s.id, { status: 'APPROVED' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({ id: s.id, status: 'APPROVED', rejection_reason: null });
    const db = await fx.row('SELECT status, reviewed_by, reviewed_at FROM sellers WHERE id = $1', [s.id]);
    expect(db.status).toBe('APPROVED');
    expect(db.reviewed_by).toBe(users.admin.id);
    expect(db.reviewed_at).not.toBeNull();

    const sms = await fx.texts(s.userId, 'SELLER_APPROVED');
    expect(sms).toHaveLength(1);
    expect(sms[0]!.recipient).toBe(s.phone);
    expect(sms[0]!.payload.text).toBe('Blynk: your seller account is approved. You can add products now: https://blynk-seller.valgrowlabs.com');

    const audit = await fx.audits('SELLER_UPDATED', s.id);
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(users.admin.id);
    expect(audit[0].old_values).toMatchObject({ status: 'PENDING' });
    expect(audit[0].new_values).toMatchObject({ status: 'APPROVED' });

    // approving again changes nothing: no second text, no second audit row
    expect((await patchSeller(s.id, { status: 'APPROVED' })).status).toBe(200);
    expect(await fx.texts(s.userId, 'SELLER_APPROVED')).toHaveLength(1);
    expect(await fx.audits('SELLER_UPDATED', s.id)).toHaveLength(1);
  });

  it('rejecting needs a reason, only works on a pending seller, texts the reason', async () => {
    const s = await fx.seller({ status: 'PENDING' });
    expect((await patchSeller(s.id, { status: 'REJECTED' })).status).toBe(400);
    expect((await patchSeller(s.id, { status: 'REJECTED', rejection_reason: 'no' })).status).toBe(400);
    expect((await fx.row('SELECT status FROM sellers WHERE id = $1', [s.id])).status).toBe('PENDING');

    const res = await patchSeller(s.id, { status: 'REJECTED', rejection_reason: ' Shop address could not be verified ' }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({ status: 'REJECTED', rejection_reason: 'Shop address could not be verified' });
    const sms = await fx.texts(s.userId, 'SELLER_REJECTED');
    expect(sms).toHaveLength(1);
    expect(sms[0]!.payload.text).toBe("Blynk: your seller application wasn't approved. Reason: Shop address could not be verified");
    expect((await fx.audits('SELLER_UPDATED', s.id))[0].new_values).toMatchObject({ status: 'REJECTED', rejection_reason: 'Shop address could not be verified' });

    // an approved seller is suspended, not rejected
    const live = await fx.seller({ status: 'APPROVED' });
    const bad = await patchSeller(live.id, { status: 'REJECTED', rejection_reason: 'Changed our minds' });
    expect(bad.status).toBe(409);
    expect(bad.body.error.code).toBe('SELLER_STATUS_INVALID');

    // a rejected seller can still be approved later, which clears the reason
    const again = await patchSeller(s.id, { status: 'APPROVED' });
    expect(again.body.data.seller).toMatchObject({ status: 'APPROVED', rejection_reason: null });
  });

  it('suspending needs an approved seller, switches their products off, and re-approving does not switch them on', async () => {
    const s = await fx.seller({ status: 'APPROVED' });
    const pending = await fx.seller({ status: 'PENDING' });
    expect((await patchSeller(pending.id, { status: 'SUSPENDED' })).body.error.code).toBe('SELLER_STATUS_INVALID');

    const p1 = await liveProduct(s.id);
    const p2 = await liveProduct(s.id);
    expect((await customerProduct(p1.id)).status).toBe(200);
    const listed = await getSellers(`?search=${encodeURIComponent(s.phone)}`);
    expect(listed.body.data.sellers[0].products_live).toBe(2);

    const res = await patchSeller(s.id, { status: 'SUSPENDED', rejection_reason: 'Late deliveries to the dark store' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.seller).toMatchObject({ status: 'SUSPENDED', products_live: 0 });
    const rows = (await pool.query('SELECT is_active FROM products WHERE seller_id = $1', [s.id])).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.is_active === false)).toBe(true);
    expect((await customerProduct(p1.id)).status).toBe(404);
    expect((await fx.audits('SELLER_UPDATED', s.id)).at(-1)!.new_values).toMatchObject({ status: 'SUSPENDED', products_switched_off: 2 });
    // no text for a suspension (the contract only texts approvals and rejections)
    expect((await fx.texts(s.userId)).filter((t) => t.notification_type.startsWith('SELLER_') && t.notification_type !== 'SELLER_PRODUCT_APPROVED')).toHaveLength(0);

    // a suspended seller's waiting submissions cannot be approved
    const waiting = await fx.submission(s.id);
    const blocked = await approve(waiting, { selling_price: 120 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('SELLER_NOT_APPROVED');

    // re-approving: products stay off until staff switch them on
    expect((await patchSeller(s.id, { status: 'APPROVED' })).body.data.seller.status).toBe('APPROVED');
    expect((await pool.query('SELECT is_active FROM products WHERE id = ANY($1)', [[p1.id, p2.id]])).rows.every((r) => r.is_active === false)).toBe(true);
    expect((await approve(waiting, { selling_price: 120 })).status).toBe(200);
  });

  it('commission percent: validated, audited, applies to the statement', async () => {
    const s = await fx.seller({ commission: 0 });
    for (const bad of [-1, 100.5, 12.345, '5']) {
      expect((await patchSeller(s.id, { commission_percent: bad })).status).toBe(400);
    }
    const res = await patchSeller(s.id, { commission_percent: 7.5 });
    expect(res.status).toBe(200);
    expect(res.body.data.seller.commission_percent).toBe(7.5);
    const audit = (await fx.audits('SELLER_UPDATED', s.id)).at(-1)!;
    expect(audit.old_values).toMatchObject({ commission_percent: 0 });
    expect(audit.new_values).toMatchObject({ commission_percent: 7.5 });
    expect((await request(app).get(`${A}/sellers/${s.id}`).set(auth(tokens.admin))).body.data.statement.commission_percent).toBe(7.5);
  });

  it('validates the body and the id', async () => {
    const s = await fx.seller();
    expect((await patchSeller(s.id, {})).status).toBe(400);
    expect((await patchSeller(s.id, { status: 'PENDING' })).status).toBe(400);
    expect((await patchSeller(s.id, { surprise: 'Mine now' })).status).toBe(400); // unknown field
    expect((await patchSeller('00000000-0000-4000-8000-000000000999', { commission_percent: 1 })).status).toBe(404);
    expect((await patchSeller('nope', { commission_percent: 1 })).status).toBe(400);
  });
});

describe('Submissions queue', () => {
  it('lists PENDING by default, oldest first, with seller, live product and category name', async () => {
    const s = await fx.seller();
    const other = await fx.seller();
    const first = await fx.submission(s.id, { name: `Queue first ${fx.stamp}` });
    const second = await fx.submission(s.id, { name: `Queue second ${fx.stamp}`, price: 55.5 });
    await fx.submission(other.id);
    const done = await fx.submission(s.id, { status: 'APPROVED' });

    const res = await getSubs(`?seller_id=${s.id}`);
    expect(res.status).toBe(200);
    const list = res.body.data.submissions as { id: string }[];
    expect(list.map((x) => x.id)).toEqual([first, second]);
    expect(list[1]).toMatchObject({
      id: second,
      kind: 'NEW',
      status: 'PENDING',
      product_id: null,
      seller_price: 55.5,
      approved_selling_price: null,
      reject_reason: null,
      reviewed_at: null,
      payload: { name: `Queue second ${fx.stamp}`, unit: '1 kg' },
      seller: { id: s.id, shop_name: s.shop, phone: s.phone, status: 'APPROVED' },
      product: null,
      category_name: expect.stringContaining('SF appr'),
    });

    const all = await getSubs(`?seller_id=${s.id}&status=ALL`);
    expect(all.body.data.submissions.map((x: { id: string }) => x.id)).toEqual([first, second, done]);
    expect((await getSubs(`?seller_id=${s.id}&status=APPROVED`)).body.data.submissions.map((x: { id: string }) => x.id)).toEqual([done]);
    expect((await getSubs('?status=NOPE')).status).toBe(400);
    expect((await getSubs('?seller_id=nope')).status).toBe(400);
  });

  it('an EDIT shows the live product next to the proposal', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id, 80, 100);
    const edit = await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 90, payload: { name: 'Renamed', unit: '2 kg' } });
    const res = await getSubs(`?seller_id=${s.id}`);
    const row = res.body.data.submissions.find((x: { id: string }) => x.id === edit);
    expect(row.product).toMatchObject({ id: product.id, selling_price: 100, purchase_cost: 80, unit: '1 kg', is_active: true });
    expect(row.payload).toMatchObject({ name: 'Renamed' });
  });
});

describe('Approving a NEW product', () => {
  it('needs the selling price, an approved seller and a pending submission', async () => {
    const s = await fx.seller();
    const sub = await fx.submission(s.id);
    const missing = await approve(sub, {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('SELLING_PRICE_REQUIRED');
    for (const bad of [0, -5, 10.123, '100']) expect((await approve(sub, { selling_price: bad })).status).toBe(400);
    expect((await approve(sub, { selling_price: 100, extra: true })).status).toBe(400);
    expect((await pool.query('SELECT count(*)::int AS n FROM products WHERE seller_id = $1', [s.id])).rows[0].n).toBe(0);

    const pendingSeller = await fx.seller({ status: 'PENDING' });
    const sub2 = await fx.submission(pendingSeller.id);
    const refused = await approve(sub2, { selling_price: 100 });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('SELLER_NOT_APPROVED');

    expect((await approve('00000000-0000-4000-8000-000000000999', { selling_price: 100 })).status).toBe(404);
    expect((await approve('nope', { selling_price: 100 })).status).toBe(400);
  });

  it('creates a live product: seller price as cost, fixed customer price, seller, stock row, "Sold by"; SMS and audit', async () => {
    const s = await fx.seller({ shop: `Amma's Kitchen ${fx.stamp}` });
    const sub = await fx.submission(s.id, { price: 80.5, name: `Pickle ${fx.stamp}` });
    const res = await approve(sub, { selling_price: 120 }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const { submission, product } = res.body.data;
    expect(submission).toMatchObject({
      id: sub,
      kind: 'NEW',
      status: 'APPROVED',
      product_id: product.id,
      seller_price: 80.5,
      approved_selling_price: 120,
      reject_reason: null,
    });
    expect(submission.reviewed_at).not.toBeNull();
    expect(product).toMatchObject({
      name: `Pickle ${fx.stamp}`,
      category_id: fx.categoryId,
      unit: '1 kg',
      pack_size: '500 g',
      description: 'Home made',
      purchase_cost: 80.5,
      pricing_mode: 'FIXED',
      fixed_selling_price: 120,
      selling_price: 120,
      is_active: true,
      is_available: true,
      seller_id: s.id,
    });
    expect(product.sku).toMatch(/^SLR-[0-9A-Z]{6}$/);
    expect(product.slug).toContain('pickle');

    const row = await fx.row('SELECT seller_id, purchase_cost::float AS cost, pricing_mode, fixed_selling_price::float AS fixed, is_active, is_available FROM products WHERE id = $1', [product.id]);
    expect(row).toEqual({ seller_id: s.id, cost: 80.5, pricing_mode: 'FIXED', fixed: 120, is_active: true, is_available: true });
    const inv = await fx.row('SELECT tracking_mode, quantity_on_hand FROM inventory WHERE product_id = $1 AND variant_id IS NULL', [product.id]);
    expect(inv).toEqual({ tracking_mode: 'TRACKED', quantity_on_hand: 0 });
    expect((await fx.row('SELECT reviewed_by FROM seller_submissions WHERE id = $1', [sub])).reviewed_by).toBe(users.admin.id);

    // customers see it, priced at the selling price (sold out until staff receive stock), "Sold by" the shop
    const mine = await customerProduct(product.id);
    expect(mine.status).toBe(200);
    expect(mine.body.data.product).toMatchObject({ id: product.id, selling_price: 120, sold_by: s.shop, is_available: false });
    expect(JSON.stringify(mine.body)).not.toMatch(/purchase_cost|seller_price|80\.5/);
    const listed = await request(app).get('/api/v1/products').query({ search: `Pickle ${fx.stamp}` });
    expect(listed.body.data.products).toHaveLength(1);
    expect(listed.body.data.products[0]).toMatchObject({ id: product.id, sold_by: s.shop });

    const sms = await fx.texts(s.userId, 'SELLER_PRODUCT_APPROVED');
    expect(sms).toHaveLength(1);
    expect(sms[0]!.payload.text).toBe(`Blynk: Pickle ${fx.stamp} is live.`);
    const audit = await fx.audits('SELLER_SUBMISSION_APPROVED', sub);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ kind: 'NEW', product_id: product.id, seller_price: 80.5, selling_price: 120, seller_id: s.id });

    // a second approval of the same submission is refused and creates nothing
    const again = await approve(sub, { selling_price: 130 });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('SUBMISSION_NOT_PENDING');
    expect((await pool.query('SELECT count(*)::int AS n FROM products WHERE seller_id = $1', [s.id])).rows[0].n).toBe(1);
  });

  it('sold_by is only the shop of an APPROVED seller; Blynk\'s own products have none', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id);
    expect((await customerProduct(product.id)).body.data.product.sold_by).toBe(s.shop);
    await pool.query(`UPDATE sellers SET status = 'PENDING' WHERE id = $1`, [s.id]);
    expect((await customerProduct(product.id)).body.data.product.sold_by).toBeNull();
    await pool.query(`UPDATE sellers SET status = 'APPROVED' WHERE id = $1`, [s.id]);
    expect((await customerProduct(product.id)).body.data.product.sold_by).toBe(s.shop);

    const own = (await request(app).get('/api/v1/products').query({ limit: 50 })).body.data.products as { sold_by: unknown; id: string }[];
    expect(own.length).toBeGreaterThan(0);
    for (const p of own) expect(p).toHaveProperty('sold_by');
    expect(own.find((p) => p.id !== product.id)?.sold_by ?? null).toBeNull();
  });

  it('staff can choose another category; an unknown one is refused and nothing is created', async () => {
    const s = await fx.seller();
    const sub = await fx.submission(s.id);
    const bad = await approve(sub, { selling_price: 100, category_id: '00000000-0000-4000-8000-000000000999' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('CATEGORY_NOT_FOUND');
    expect((await fx.row('SELECT status FROM seller_submissions WHERE id = $1', [sub])).status).toBe('PENDING');
    expect((await pool.query('SELECT count(*)::int AS n FROM products WHERE seller_id = $1', [s.id])).rows[0].n).toBe(0);

    const ok = await approve(sub, { selling_price: 100, category_id: fx.otherCategoryId });
    expect(ok.status).toBe(200);
    expect(ok.body.data.product.category_id).toBe(fx.otherCategoryId);
  });

  it('two products with the same name get their own slug and SKU', async () => {
    const s = await fx.seller();
    const name = `Twin ${fx.stamp}`;
    const a = await approve(await fx.submission(s.id, { name }), { selling_price: 100 });
    const b = await approve(await fx.submission(s.id, { name }), { selling_price: 100 });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.data.product.slug).not.toBe(b.body.data.product.slug);
    expect(a.body.data.product.sku).not.toBe(b.body.data.product.sku);
  });

  it('a submission with incomplete details is refused', async () => {
    const s = await fx.seller();
    const sub = await fx.submission(s.id, { payload: { name: 'No unit or category' } });
    const res = await approve(sub, { selling_price: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SUBMISSION_INVALID');
  });
});

describe('Approving an EDIT', () => {
  it('without a price change: applies the fields, keeps the price, slug and SKU; selling price optional', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id, 80, 100);
    const edit = await fx.submission(s.id, {
      kind: 'EDIT',
      productId: product.id,
      price: 80,
      payload: { name: `Renamed ${fx.stamp}`, category_id: fx.categoryId, unit: '2 kg', pack_size: null, description: 'New text', image_url: 'https://example.com/a.jpg', barcode: '123456' },
    });
    const res = await approve(edit);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.submission).toMatchObject({ status: 'APPROVED', kind: 'EDIT', product_id: product.id, approved_selling_price: 100 });
    expect(res.body.data.product).toMatchObject({
      id: product.id,
      name: `Renamed ${fx.stamp}`,
      unit: '2 kg',
      pack_size: null,
      description: 'New text',
      image_url: 'https://example.com/a.jpg',
      barcode: '123456',
      purchase_cost: 80,
      fixed_selling_price: 100,
      selling_price: 100,
      slug: product.slug,
      sku: product.sku,
      seller_id: s.id,
    });
    expect((await customerProduct(product.id)).body.data.product).toMatchObject({ name: `Renamed ${fx.stamp}`, selling_price: 100 });
    expect((await fx.texts(s.userId, 'SELLER_PRODUCT_APPROVED')).at(-1)!.payload.text).toBe(`Blynk: Renamed ${fx.stamp} is live.`);
    expect((await fx.audits('SELLER_SUBMISSION_APPROVED', edit))[0].new_values).toMatchObject({ kind: 'EDIT', product_id: product.id });
  });

  it('with a price change: the selling price is required, then cost and customer price both move', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id, 80, 100);
    const edit = await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 95, payload: { name: 'Same but dearer' } });

    const missing = await approve(edit, {});
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('SELLING_PRICE_REQUIRED');
    // nothing changed
    expect((await fx.row('SELECT purchase_cost::float AS c, fixed_selling_price::float AS f FROM products WHERE id = $1', [product.id]))).toEqual({ c: 80, f: 100 });
    expect((await fx.row('SELECT status FROM seller_submissions WHERE id = $1', [edit])).status).toBe('PENDING');

    const ok = await approve(edit, { selling_price: 130 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.submission).toMatchObject({ seller_price: 95, approved_selling_price: 130 });
    expect(ok.body.data.product).toMatchObject({ name: 'Same but dearer', purchase_cost: 95, pricing_mode: 'FIXED', fixed_selling_price: 130, selling_price: 130 });
    expect((await customerProduct(product.id)).body.data.product.selling_price).toBe(130);
  });

  it('an explicit selling price on an unchanged seller price re-prices the product', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id, 80, 100);
    const edit = await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 80, payload: { description: 'Just words' } });
    const ok = await approve(edit, { selling_price: 110 });
    expect(ok.body.data.product).toMatchObject({ purchase_cost: 80, fixed_selling_price: 110, description: 'Just words', name: expect.any(String) });
  });

  it('a running offer must stay below the new price', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id, 80, 100);
    await pool.query('UPDATE products SET offer_price = 90 WHERE id = $1', [product.id]);
    const edit = await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 60, payload: {} });
    const refused = await approve(edit, { selling_price: 85 });
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('OFFER_PRICE_NOT_LOWER');
    expect((await fx.row('SELECT fixed_selling_price::float AS f FROM products WHERE id = $1', [product.id])).f).toBe(100);
    expect((await approve(edit, { selling_price: 95 })).status).toBe(200);
  });

  it('refuses an edit whose product is gone or is not the seller\'s', async () => {
    const s = await fx.seller();
    const other = await fx.seller();
    const theirs = await liveProduct(other.id);
    const stolen = await fx.submission(s.id, { kind: 'EDIT', productId: theirs.id, price: 80, payload: { name: 'Hijack' } });
    const res = await approve(stolen, { selling_price: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await fx.row('SELECT name FROM products WHERE id = $1', [theirs.id])).name).not.toBe('Hijack');

    const mine = await liveProduct(s.id);
    await pool.query(`UPDATE products SET deleted_at = now() WHERE id = $1`, [mine.id]);
    const orphan = await fx.submission(s.id, { kind: 'EDIT', productId: mine.id, price: 80, payload: {} });
    expect((await approve(orphan, { selling_price: 100 })).body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('a newer edit replaces the waiting one: only the newest can be approved', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id, 80, 100);
    const older = await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 80, payload: { name: 'Older proposal' } });
    // one waiting edit per product (unique index); the seller API withdraws the old one first
    await expect(fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 80, payload: { name: 'Clash' } })).rejects.toThrow(/uq_seller_submissions_pending_edit/);
    await pool.query(`UPDATE seller_submissions SET status = 'WITHDRAWN' WHERE id = $1`, [older]);
    const newer = await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 80, payload: { name: 'Newer proposal' } });

    const queue = (await getSubs(`?seller_id=${s.id}`)).body.data.submissions.filter((x: { kind: string }) => x.kind === 'EDIT');
    expect(queue.map((x: { id: string }) => x.id)).toEqual([newer]);

    const stale = await approve(older, { selling_price: 100 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('SUBMISSION_NOT_PENDING');
    expect((await reject(older, { reason: 'too late' })).status).toBe(409);
    expect((await fx.row('SELECT name FROM products WHERE id = $1', [product.id])).name).not.toMatch(/proposal/);

    expect((await approve(newer)).body.data.product.name).toBe('Newer proposal');
    // with the waiting edit decided, the seller may propose again
    expect(await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 80, payload: { name: 'Third' } })).toBeTruthy();
  });
});

describe('Rejecting a submission', () => {
  it('needs a reason; records it; texts the seller; audited; the live product is untouched', async () => {
    const s = await fx.seller();
    const product = await liveProduct(s.id, 80, 100);
    const edit = await fx.submission(s.id, { kind: 'EDIT', productId: product.id, price: 40, payload: { name: 'Cheap trick' } });

    expect((await reject(edit, {})).status).toBe(400);
    expect((await reject(edit, { reason: 'x' })).status).toBe(400);
    expect((await reject(edit, { reason: 'y'.repeat(301) })).status).toBe(400);
    expect((await fx.row('SELECT status FROM seller_submissions WHERE id = $1', [edit])).status).toBe('PENDING');

    const res = await reject(edit, { reason: ' Price is below the market ' }, opsToken);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.submission).toMatchObject({ id: edit, status: 'REJECTED', reject_reason: 'Price is below the market', kind: 'EDIT' });
    expect(res.body.data.submission.reviewed_at).not.toBeNull();
    expect((await fx.row('SELECT reviewed_by FROM seller_submissions WHERE id = $1', [edit])).reviewed_by).toBe(users.admin.id);
    expect((await fx.row('SELECT name, purchase_cost::float AS c FROM products WHERE id = $1', [product.id])).c).toBe(80);

    const texts = await fx.texts(s.userId, 'SELLER_PRODUCT_REJECTED');
    expect(texts).toHaveLength(1);
    const name = (await fx.row('SELECT name FROM products WHERE id = $1', [product.id])).name;
    expect(texts[0]!.payload.text).toBe(`Blynk: Cheap trick was not approved: Price is below the market`);
    expect(name).not.toBe('Cheap trick');
    const audit = await fx.audits('SELLER_SUBMISSION_REJECTED', edit);
    expect(audit).toHaveLength(1);
    expect(audit[0].new_values).toMatchObject({ reason: 'Price is below the market', seller_id: s.id });

    // decided: neither button works a second time
    expect((await reject(edit, { reason: 'again please' })).body.error.code).toBe('SUBMISSION_NOT_PENDING');
    expect((await approve(edit, { selling_price: 100 })).body.error.code).toBe('SUBMISSION_NOT_PENDING');
  });

  it('a NEW product rejection creates no product; a seller who is not approved can still be answered', async () => {
    const s = await fx.seller({ status: 'PENDING' });
    const sub = await fx.submission(s.id, { name: `Declined ${fx.stamp}` });
    const res = await reject(sub, { reason: 'Not something we sell' });
    expect(res.status).toBe(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM products WHERE seller_id = $1', [s.id])).rows[0].n).toBe(0);
    expect((await fx.texts(s.userId, 'SELLER_PRODUCT_REJECTED'))[0]!.payload.text).toBe(`Blynk: Declined ${fx.stamp} was not approved: Not something we sell`);
  });

  it('a failed SMS never fails the approval', async () => {
    // a phone that is a placeholder (staff-style) is skipped by the outbox; the decision still stands
    const s = await fx.seller();
    await pool.query(`UPDATE users SET phone = $1 WHERE id = $2`, [`nophone:${String(fx.stamp).slice(-8)}`, s.userId]);
    const sub = await fx.submission(s.id);
    expect((await approve(sub, { selling_price: 100 })).status).toBe(200);
    expect((await fx.texts(s.userId, 'SELLER_PRODUCT_APPROVED'))).toHaveLength(0);
  });
});
