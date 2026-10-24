import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { setPurchasingReadyForTests } from '../src/modules/purchasing/purchasing.ready.js';
import { auth, stockFixtures, tokens, users, type Tracked } from './helpers/stock.js';
import { sellerFixtures } from './helpers/seller-fixtures.js';

/**
 * Reorder suggestions and purchase orders (migration 058; owner, 2026-10-25). Real local Postgres:
 * products and stock come from the stock fixtures (stock moves through the ledger), velocity from
 * orders that go through the normal flow and are delivered. Everything made here is removed again
 * (purchase orders, suppliers, products, orders, the seller, audit rows).
 */
const app = createApp();
const orders = stockFixtures(app, 'PURCH-');
const fx = sellerFixtures('po');
const opsToken = generateAccessToken({ ...users.admin, role: 'OPERATIONS' });
const A = '/api/v1/admin';
const stamp = String(Date.now()).slice(-6);
const poIds: string[] = [];
const supplierIds: string[] = [];

const get = (path: string, token = tokens.admin) => request(app).get(`${A}${path}`).set(auth(token));
const post = (path: string, body: object = {}, token = tokens.admin) => request(app).post(`${A}${path}`).set(auth(token)).send(body);
const patch = (path: string, body: object, token = tokens.admin) => request(app).patch(`${A}${path}`).set(auth(token)).send(body);

async function supplier(name: string, phone: string | null = null): Promise<string> {
  const res = await post('/suppliers', { name: `${name} ${stamp}`, ...(phone ? { contact_phone: phone } : {}) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const id = (res.body.data.supplier?.id ?? res.body.data.id) as string;
  supplierIds.push(id);
  return id;
}

async function createPo(body: object, token = tokens.admin) {
  const res = await post('/purchase-orders', body, token);
  if (res.status === 201) poIds.push(res.body.data.purchase_order.id);
  return res;
}

const threshold = (p: Tracked, value: number) =>
  patch(`/inventory/${p.productId}/threshold`, { low_stock_threshold: value }).then((r) => expect(r.status, JSON.stringify(r.body)).toBe(200));

const stockOf = async (p: Tracked) => orders.onHand(p);
const costOf = async (p: Tracked) =>
  Number((await pool.query('SELECT purchase_cost FROM products WHERE id = $1', [p.productId])).rows[0].purchase_cost);

/** Delivers an order of these lines (stock must be there). */
async function delivered(lines: { product_id: string; quantity: number }[], supplierId?: string) {
  const order = await orders.placeOrder(lines);
  for (const id of order.itemIds) expect((await orders.source(order.id, id, supplierId ? { supplier_id: supplierId } : {})).status).toBe(200);
  expect((await orders.pack(order.id)).status).toBe(200);
  await orders.deliver(order.id);
  return order;
}

const suggestionFor = async (p: Tracked, query = '') => {
  const res = await get(`/reorder-suggestions${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const groups = res.body.data.suppliers as { supplier_id: string | null; items: { product_id: string }[] }[];
  for (const g of groups) {
    const item = g.items.find((i) => i.product_id === p.productId);
    if (item) return { group: g, item: item as Record<string, any>, body: res.body.data };
  }
  return { group: null, item: null, body: res.body.data };
};

const ledger = async (p: Tracked) => (await orders.ledgerFor(p)).filter((r) => r.adjustment_type === 'PURCHASE_RESTOCK');
const auditActions = async (id: string) =>
  (await pool.query('SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at', [id])).rows.map((r) => r.action as string);

let sup: string;
let supPhone: string;
let sold: Tracked; // sold 8 in the window, 2 left, threshold 5
let empty: Tracked; // never sold, none in stock
let untracked: Tracked;

beforeAll(async () => {
  setPurchasingReadyForTests(null);
  await orders.setup();
  await fx.setup();
  sup = await supplier('Lanka Wholesale');
  supPhone = await supplier('Phone Supplier', '0771234567');
  sold = await orders.product({ onHand: 10 });
  empty = await orders.product({ onHand: 0 });
  untracked = await orders.product({ tracked: false });
  await threshold(sold, 5);
  await threshold(empty, 5);
  await delivered([{ product_id: sold.productId, quantity: 8 }], sup);
}, 120_000);

afterAll(async () => {
  setPurchasingReadyForTests(null);
  const productIds = orders.created.products;
  if (poIds.length) await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [poIds]);
  if (productIds.length) await pool.query('DELETE FROM audit_logs WHERE entity_id = ANY($1)', [productIds]);
  if (poIds.length) await pool.query('DELETE FROM purchase_orders WHERE id = ANY($1)', [poIds]);
  await pool.query('UPDATE products SET seller_id = NULL WHERE sku LIKE $1', ['PURCH-%']);
  await orders.cleanup();
  await fx.cleanup();
  if (supplierIds.length) {
    await pool.query('DELETE FROM sourcing_records WHERE supplier_id = ANY($1)', [supplierIds]);
    await pool.query('DELETE FROM suppliers WHERE id = ANY($1)', [supplierIds]);
  }
}, 60_000);

describe('reorder suggestions', () => {
  it('works out velocity, days left, quantity and chips from delivered orders, grouped by the supplier it was sourced from', async () => {
    const { group, item, body } = await suggestionFor(sold);
    expect(group?.supplier_id).toBe(sup);
    expect(item).not.toBeNull();
    expect(item!.units_sold).toBe(8);
    expect(item!.avg_daily_units).toBe(0.57);
    expect(item!.quantity_on_hand).toBe(2);
    expect(item!.days_of_stock_left).toBe(3.5);
    // ceil(8/14 x (7 + 1)) = 5, + threshold 5 = 10, - 2 available = 8
    expect(item!.suggested_quantity).toBe(8);
    expect(item!.reasons).toEqual(['LOW', 'WONT_LAST']);
    expect(item!.last_cost).toBe(100);
    expect(item!.estimated_cost).toBe(800);
    expect(item!.on_order).toBe(0);
    expect(body.params).toMatchObject({ days: 14, cover_days: 7, lead_days: 1 });
  });

  it('an unsold, empty product has no supplier yet, is Out of stock and goes to the last group', async () => {
    const { group, item, body } = await suggestionFor(empty);
    expect(group?.supplier_id).toBeNull();
    expect(item!.reasons).toEqual(['OUT']);
    expect(item!.avg_daily_units).toBe(0);
    expect(item!.days_of_stock_left).toBeNull();
    expect(item!.suggested_quantity).toBe(5);
    const groups = body.suppliers as { supplier_id: string | null }[];
    expect(groups[groups.length - 1]!.supplier_id).toBeNull();
  });

  it('rounds up to a case when the pack size names one', async () => {
    await pool.query(`UPDATE products SET pack_size = 'Case of 6' WHERE id = $1`, [empty.productId]);
    const { item } = await suggestionFor(empty);
    expect(item!.buy_multiple).toBe(6);
    expect(item!.suggested_quantity).toBe(6);
    await pool.query(`UPDATE products SET pack_size = NULL WHERE id = $1`, [empty.productId]);
  });

  it('cover and lead days change the quantity; days must be 14 or 28', async () => {
    const wide = await suggestionFor(sold, '?days=28&cover_days=14&lead_days=2');
    expect(wide.body.params).toMatchObject({ days: 28, cover_days: 14, lead_days: 2 });
    // 8/28 = 0.29/day x 16 = 4.57 -> 5, + 5 - 2 = 8
    expect(wide.item!.avg_daily_units).toBe(0.29);
    expect(wide.item!.suggested_quantity).toBe(8);
    expect((await get('/reorder-suggestions?days=7')).status).toBe(400);
    expect((await get('/reorder-suggestions?cover_days=0')).status).toBe(400);
  });

  it('leaves out untracked products and seller-held products', async () => {
    expect((await suggestionFor(untracked)).item).toBeNull();
    const s = await fx.seller();
    await pool.query('UPDATE products SET seller_id = $1 WHERE id = $2', [s.id, empty.productId]);
    expect((await suggestionFor(empty)).item).toBeNull();
    await pool.query('UPDATE products SET seller_id = NULL WHERE id = $1', [empty.productId]);
    expect((await suggestionFor(empty)).item).not.toBeNull();
  });

  it('what is already on order (sent) is not bought again; a draft is only shown', async () => {
    const draft = await createPo({ supplier_id: sup, lines: [{ product_id: sold.productId, ordered_qty: 8 }] });
    expect(draft.status).toBe(201);
    let s = await suggestionFor(sold);
    expect(s.item!.in_draft).toBe(8);
    expect(s.item!.on_order).toBe(0);
    expect(s.item!.suggested_quantity).toBe(8);

    expect((await post(`/purchase-orders/${draft.body.data.purchase_order.id}/send`)).status).toBe(200);
    s = await suggestionFor(sold);
    expect(s.item).toBeNull(); // 8 on order covers the 8 suggested

    expect((await post(`/purchase-orders/${draft.body.data.purchase_order.id}/cancel`, { reason: 'Changed my mind' })).status).toBe(200);
    s = await suggestionFor(sold);
    expect(s.item!.suggested_quantity).toBe(8);
  });

  it('a product last ordered from a supplier moves to that supplier', async () => {
    const po = await createPo({ supplier_id: supPhone, lines: [{ product_id: empty.productId, ordered_qty: 3 }] });
    expect(po.status).toBe(201);
    // cancelled orders do not count; a draft does
    const s = await suggestionFor(empty);
    expect(s.group?.supplier_id).toBe(supPhone);
    await post(`/purchase-orders/${po.body.data.purchase_order.id}/cancel`, { reason: 'test' });
    expect((await suggestionFor(empty)).group?.supplier_id).toBeNull();
  });
});

describe('purchase order lifecycle', () => {
  it('creates a draft with a BP number, default costs and the supplier; edits it; sends it with the share text', async () => {
    const res = await createPo({
      supplier_id: supPhone,
      expected_on: '2026-12-01',
      notes: 'Before noon',
      lines: [
        { product_id: sold.productId, ordered_qty: 10 },
        { product_id: empty.productId, ordered_qty: 6, unit_cost: 12.5, note: 'any brand' },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const po = res.body.data.purchase_order;
    expect(po.po_number).toMatch(/^BP-\d{4,}$/);
    expect(po.status).toBe('DRAFT');
    expect(po.expected_on).toBe('2026-12-01');
    expect(po.lines).toHaveLength(2);
    const line = (id: string) => po.lines.find((l: any) => l.product_id === id);
    expect(line(sold.productId)).toMatchObject({ ordered_qty: 10, received_qty: 0, unit_cost: 100, line_total: 1000, stock_counted: true });
    expect(line(empty.productId)).toMatchObject({ unit_cost: 12.5, note: 'any brand', line_total: 75 });
    expect(po.totals).toMatchObject({ lines: 2, units_ordered: 16, cost_ordered: 1075 });

    // edit while a draft: notes, day, and the lines
    const edited = await patch(`/purchase-orders/${po.id}`, { notes: 'After lunch', lines: [{ product_id: sold.productId, ordered_qty: 12 }] });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.data.purchase_order.lines).toHaveLength(1);
    expect(edited.body.data.purchase_order.lines[0].ordered_qty).toBe(12);
    expect(edited.body.data.purchase_order.notes).toBe('After lunch');
    expect(edited.body.data.purchase_order.expected_on).toBe('2026-12-01');

    const sent = await post(`/purchase-orders/${po.id}/send`);
    expect(sent.status).toBe(200);
    expect(sent.body.data.purchase_order.status).toBe('SENT');
    expect(sent.body.data.purchase_order.sent_at).toBeTruthy();
    expect(sent.body.data.message).toMatch(/^Order for Phone Supplier \d+:\n12 x /);
    expect(sent.body.data.message).toContain('Needed by: 1 Dec 2026');
    expect(sent.body.data.message).toContain(`Ref: ${po.po_number}`);
    expect(sent.body.data.whatsapp_url).toMatch(/^https:\/\/wa\.me\/94771234567\?text=/);

    // sending again only returns the text; lines and supplier are frozen, notes still open
    expect((await post(`/purchase-orders/${po.id}/send`)).status).toBe(200);
    expect((await patch(`/purchase-orders/${po.id}`, { lines: [{ product_id: sold.productId, ordered_qty: 1 }] })).status).toBe(409);
    expect((await patch(`/purchase-orders/${po.id}`, { supplier_id: sup })).status).toBe(409);
    expect((await patch(`/purchase-orders/${po.id}`, { notes: 'Call first' })).status).toBe(200);

    expect(await auditActions(po.id)).toEqual(['PURCHASE_ORDER_CREATED', 'PURCHASE_ORDER_UPDATED', 'PURCHASE_ORDER_SENT', 'PURCHASE_ORDER_UPDATED']);
  });

  it('a supplier without a phone gets no WhatsApp link; no supplier is allowed on a draft', async () => {
    const po = await createPo({ supplier_id: sup, lines: [{ product_id: empty.productId, ordered_qty: 2 }] });
    const sent = await post(`/purchase-orders/${po.body.data.purchase_order.id}/send`);
    expect(sent.body.data.whatsapp_url).toBeNull();
    expect(sent.body.data.message).toMatch(/^Order for Lanka Wholesale \d+:/);
    const none = await createPo({ lines: [{ product_id: empty.productId, ordered_qty: 2 }] });
    expect(none.status).toBe(201);
    expect(none.body.data.purchase_order.supplier_id).toBeNull();
    await post(`/purchase-orders/${po.body.data.purchase_order.id}/cancel`, { reason: 'test' });
    await post(`/purchase-orders/${none.body.data.purchase_order.id}/cancel`, { reason: 'test' });
  });

  it('receives partly, then the rest: stock and ledger rows added once per receive, cost updated when asked', async () => {
    const created = await createPo({
      supplier_id: sup,
      lines: [
        { product_id: sold.productId, ordered_qty: 10 },
        { product_id: empty.productId, ordered_qty: 6 },
      ],
    });
    const po = created.body.data.purchase_order;
    const itemA = po.lines.find((l: any) => l.product_id === sold.productId).id as string;
    const itemB = po.lines.find((l: any) => l.product_id === empty.productId).id as string;

    // not sent yet
    expect((await post(`/purchase-orders/${po.id}/receive`, { lines: [{ item_id: itemA, received_qty: 1 }] })).status).toBe(409);
    expect((await post(`/purchase-orders/${po.id}/send`)).status).toBe(200);

    const stockBefore = await stockOf(sold);
    const ledgerBefore = (await ledger(sold)).length;
    const first = await post(`/purchase-orders/${po.id}/receive`, {
      lines: [{ item_id: itemA, received_qty: 4, unit_cost: 90, update_product_cost: true }],
    });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.data.purchase_order.status).toBe('PARTIAL');
    expect(first.body.data.purchase_order.received_at).toBeNull();
    expect(first.body.data.received).toHaveLength(1);
    expect(first.body.data.received[0]).toMatchObject({ stock_added: true, stock_on_hand: stockBefore + 4 });
    expect(first.body.data.skipped).toEqual([]);
    expect(await stockOf(sold)).toBe(stockBefore + 4);
    const rows = await ledger(sold);
    expect(rows).toHaveLength(ledgerBefore + 1);
    expect(rows[rows.length - 1]).toMatchObject({ quantity_delta: 4, previous_quantity: stockBefore, new_quantity: stockBefore + 4, created_by_user_id: users.admin.id });
    expect(rows[rows.length - 1]!.notes).toContain(po.po_number);
    expect(await costOf(sold)).toBe(90);
    const lineA = first.body.data.purchase_order.lines.find((l: any) => l.id === itemA);
    expect(lineA).toMatchObject({ received_qty: 4, remaining_qty: 6, unit_cost: 90 });

    // the rest: A arrives with 1 extra, B in full
    const second = await post(`/purchase-orders/${po.id}/receive`, {
      lines: [
        { item_id: itemA, received_qty: 7 },
        { item_id: itemB, received_qty: 6 },
      ],
    });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.data.purchase_order.status).toBe('RECEIVED');
    expect(second.body.data.purchase_order.received_at).toBeTruthy();
    expect(second.body.data.purchase_order.lines.find((l: any) => l.id === itemA).received_qty).toBe(11);
    expect(await stockOf(sold)).toBe(stockBefore + 11);
    expect(await stockOf(empty)).toBe(6);
    await orders.expectLedgerChain(sold);
    await orders.expectLedgerChain(empty);

    // closed: nothing more can be received, edited, sent or cancelled
    expect((await post(`/purchase-orders/${po.id}/receive`, { lines: [{ item_id: itemA, received_qty: 1 }] })).status).toBe(409);
    expect((await patch(`/purchase-orders/${po.id}`, { notes: 'x' })).status).toBe(409);
    expect((await post(`/purchase-orders/${po.id}/send`)).status).toBe(409);
    expect((await post(`/purchase-orders/${po.id}/cancel`, { reason: 'late' })).status).toBe(409);

    const actions = await auditActions(po.id);
    expect(actions).toEqual(['PURCHASE_ORDER_CREATED', 'PURCHASE_ORDER_SENT', 'PURCHASE_ORDER_RECEIVED', 'PURCHASE_ORDER_RECEIVED']);
    expect(await auditActions(sold.productId)).toContain('PURCHASE_ORDER_COST_UPDATED');
  });

  it('receiving is all or nothing: a bad line leaves the stock and the order untouched', async () => {
    const created = await createPo({ supplier_id: sup, lines: [{ product_id: sold.productId, ordered_qty: 5 }] });
    const po = created.body.data.purchase_order;
    const item = po.lines[0].id as string;
    await post(`/purchase-orders/${po.id}/send`);
    const before = await stockOf(sold);
    const rowsBefore = (await ledger(sold)).length;

    const foreign = await post(`/purchase-orders/${po.id}/receive`, {
      lines: [
        { item_id: item, received_qty: 2 },
        { item_id: '00000000-0000-4000-8000-000000000000', received_qty: 1 },
      ],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.code).toBe('ITEM_NOT_ON_ORDER');
    expect((await post(`/purchase-orders/${po.id}/receive`, { lines: [{ item_id: item, received_qty: 0 }] })).body.error.code).toBe('NOTHING_TO_RECEIVE');
    expect((await post(`/purchase-orders/${po.id}/receive`, { lines: [{ item_id: item, received_qty: 2, update_product_cost: true }] })).body.error.code).toBe(
      'UNIT_COST_REQUIRED'
    );
    expect((await post(`/purchase-orders/${po.id}/receive`, { lines: [{ item_id: item, received_qty: -1 }] })).status).toBe(400);
    expect(await stockOf(sold)).toBe(before);
    expect((await ledger(sold)).length).toBe(rowsBefore);
    expect((await get(`/purchase-orders/${po.id}`)).body.data.purchase_order.status).toBe('SENT');

    // closing short: the supplier will not send the rest
    const short = await post(`/purchase-orders/${po.id}/receive`, { lines: [{ item_id: item, received_qty: 2 }], close_short: true });
    expect(short.status).toBe(200);
    expect(short.body.data.purchase_order.status).toBe('RECEIVED');
    expect(await stockOf(sold)).toBe(before + 2);
  });

  it('an untracked product is received on the order but adds no stock, and the answer says why', async () => {
    const created = await createPo({
      supplier_id: sup,
      lines: [
        { product_id: untracked.productId, ordered_qty: 4 },
        { product_id: empty.productId, ordered_qty: 3 },
      ],
    });
    const po = created.body.data.purchase_order;
    expect(po.lines.find((l: any) => l.product_id === untracked.productId).stock_counted).toBe(false);
    await post(`/purchase-orders/${po.id}/send`);
    const emptyBefore = await stockOf(empty);
    const res = await post(`/purchase-orders/${po.id}/receive`, {
      lines: po.lines.map((l: any) => ({ item_id: l.id, received_qty: l.ordered_qty })),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.purchase_order.status).toBe('RECEIVED');
    expect(res.body.data.skipped).toHaveLength(1);
    expect(res.body.data.skipped[0].note).toMatch(/not counted/i);
    expect(res.body.data.skipped[0].name).toContain('Stock test');
    expect(res.body.data.received).toHaveLength(2);
    expect(await stockOf(empty)).toBe(emptyBefore + 3);
    const inv = (await pool.query('SELECT 1 FROM inventory_adjustments a JOIN inventory i ON i.id = a.inventory_id WHERE i.product_id = $1 AND a.adjustment_type = $2', [
      untracked.productId,
      'PURCHASE_RESTOCK',
    ])).rows;
    expect(inv).toHaveLength(0);
  });

  it('cancelling needs a reason, works on open orders and closes them', async () => {
    const draft = await createPo({ supplier_id: sup, lines: [{ product_id: empty.productId, ordered_qty: 2 }] });
    const id = draft.body.data.purchase_order.id as string;
    expect((await post(`/purchase-orders/${id}/cancel`, {})).status).toBe(400);
    expect((await post(`/purchase-orders/${id}/cancel`, { reason: '  ' })).status).toBe(400);
    const res = await post(`/purchase-orders/${id}/cancel`, { reason: 'Supplier closed' });
    expect(res.status).toBe(200);
    expect(res.body.data.purchase_order).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Supplier closed' });
    expect((await post(`/purchase-orders/${id}/send`)).status).toBe(409);
    expect((await post(`/purchase-orders/${id}/cancel`, { reason: 'again' })).status).toBe(409);
    expect((await post(`/purchase-orders/${id}/receive`, { lines: [{ item_id: draft.body.data.purchase_order.lines[0].id, received_qty: 1 }] })).status).toBe(409);
    expect(await auditActions(id)).toEqual(['PURCHASE_ORDER_CREATED', 'PURCHASE_ORDER_CANCELLED']);
  });

  it('refuses bad lines: unknown product, duplicates, zero quantity, seller product, unknown supplier', async () => {
    const line = { product_id: empty.productId, ordered_qty: 1 };
    expect((await post('/purchase-orders', { lines: [] })).status).toBe(400);
    expect((await post('/purchase-orders', { lines: [{ ...line, ordered_qty: 0 }] })).status).toBe(400);
    expect((await post('/purchase-orders', { lines: [{ ...line, ordered_qty: 1.5 }] })).status).toBe(400);
    expect((await post('/purchase-orders', { lines: [{ ...line, unit_cost: -1 }] })).status).toBe(400);
    expect((await post('/purchase-orders', { expected_on: '2026-02-30', lines: [line] })).status).toBe(400);
    expect((await post('/purchase-orders', { lines: [line, line] })).body.error.code).toBe('DUPLICATE_LINE');
    expect((await post('/purchase-orders', { lines: [{ product_id: '00000000-0000-4000-8000-000000000000', ordered_qty: 1 }] })).body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect((await post('/purchase-orders', { supplier_id: '00000000-0000-4000-8000-000000000000', lines: [line] })).body.error.code).toBe('SUPPLIER_NOT_FOUND');
    const s = await fx.seller();
    await pool.query('UPDATE products SET seller_id = $1 WHERE id = $2', [s.id, empty.productId]);
    expect((await post('/purchase-orders', { lines: [line] })).body.error.code).toBe('SELLER_PRODUCT');
    await pool.query('UPDATE products SET seller_id = NULL WHERE id = $1', [empty.productId]);
  });

  it('lists and finds orders: open first, by status, supplier and number', async () => {
    const created = await createPo({ supplier_id: supPhone, lines: [{ product_id: empty.productId, ordered_qty: 1 }] });
    const po = created.body.data.purchase_order;
    const open = await get('/purchase-orders?status=OPEN&limit=100');
    expect(open.status).toBe(200);
    expect(open.body.data.purchase_orders.every((p: any) => ['DRAFT', 'SENT', 'PARTIAL'].includes(p.status))).toBe(true);
    expect(open.body.data.purchase_orders.some((p: any) => p.id === po.id)).toBe(true);
    const bySearch = await get(`/purchase-orders?search=${po.po_number}`);
    expect(bySearch.body.data.purchase_orders.map((p: any) => p.id)).toEqual([po.id]);
    expect(bySearch.body.data.purchase_orders[0]).toMatchObject({ line_count: 1, units_ordered: 1, units_received: 0, supplier_id: supPhone });
    const bySupplier = await get(`/purchase-orders?supplier_id=${supPhone}&status=CANCELLED&limit=100`);
    expect(bySupplier.body.data.purchase_orders.every((p: any) => p.status === 'CANCELLED' && p.supplier_id === supPhone)).toBe(true);
    expect((await get('/purchase-orders?status=NOPE')).status).toBe(400);
    expect((await get('/purchase-orders/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('/purchase-orders/not-an-id')).status).toBe(400);
    await post(`/purchase-orders/${po.id}/cancel`, { reason: 'test' });
  });
});

describe('guard and roles', () => {
  it('answers 503 PURCHASING_NOT_READY on every route before migration 058, and /store is untouched', async () => {
    setPurchasingReadyForTests(false);
    try {
      const id = '00000000-0000-4000-8000-000000000000';
      const calls = [
        get('/reorder-suggestions'),
        get('/purchase-orders'),
        post('/purchase-orders', { lines: [{ product_id: empty.productId, ordered_qty: 1 }] }),
        get(`/purchase-orders/${id}`),
        patch(`/purchase-orders/${id}`, { notes: 'x' }),
        post(`/purchase-orders/${id}/send`),
        post(`/purchase-orders/${id}/receive`, { lines: [{ item_id: id, received_qty: 1 }] }),
        post(`/purchase-orders/${id}/cancel`, { reason: 'x' }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(503);
        expect(res.body.error.code).toBe('PURCHASING_NOT_READY');
      }
      expect((await request(app).get('/api/v1/store')).status).toBe(200);
    } finally {
      setPurchasingReadyForTests(null);
    }
  });

  it('Admin and Operations may use it; customers, Inventory staff and guests may not', async () => {
    expect((await get('/reorder-suggestions', opsToken)).status).toBe(200);
    expect((await get('/purchase-orders', opsToken)).status).toBe(200);
    const made = await createPo({ lines: [{ product_id: empty.productId, ordered_qty: 1 }] }, opsToken);
    expect(made.status).toBe(201);
    await post(`/purchase-orders/${made.body.data.purchase_order.id}/cancel`, { reason: 'test' }, opsToken);

    for (const token of [tokens.customer, tokens.staff, tokens.rider]) {
      expect((await get('/reorder-suggestions', token)).status).toBe(403);
      expect((await get('/purchase-orders', token)).status).toBe(403);
      expect((await post('/purchase-orders', { lines: [{ product_id: empty.productId, ordered_qty: 1 }] }, token)).status).toBe(403);
    }
    expect((await request(app).get(`${A}/purchase-orders`)).status).toBe(401);
    expect((await request(app).get(`${A}/reorder-suggestions`)).status).toBe(401);
  });
});
