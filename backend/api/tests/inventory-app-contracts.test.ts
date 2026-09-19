import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

/**
 * Backend contracts the Inventory app depends on (Phase 0).
 *
 *  G1  every catalog product is visible to Inventory, including products
 *      created in Admin that have never had an inventory row
 *  G2  a cross-product adjustment ledger
 *  B1  an order item cannot be sourced twice
 *  D3  manual adjustments: restock (+), damage write-off (−), audit (±),
 *      tracked products only
 *  G4  a duplicate supplier code is a 409, not a 500
 *  -   customer payloads never carry inventory, supplier or cost data
 *
 * Every row this file creates is tracked by id and removed in afterAll.
 */
describe('Inventory app backend contracts', () => {
  const app = createApp();
  const STORE = '018dc3f0-4a82-789a-8b1b-947f61ad8821';

  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const customer = { id: 'a0000001-0000-0000-0000-000000000001', phone: '+94771234567', role: 'CUSTOMER' as const };
  const tokenAdmin = generateAccessToken(admin);
  const tokenStaff = generateAccessToken(staff);
  const tokenCustomer = generateAccessToken(customer);
  const as = (token: string) => (req: request.Test) => req.set('Authorization', `Bearer ${token}`);
  const asAdmin = as(tokenAdmin);
  const asStaff = as(tokenStaff);
  const asCustomer = as(tokenCustomer);

  const SKU_PREFIX = 'TEST-SKU-INVAPP-';
  const created = {
    products: [] as string[],
    orders: [] as string[],
    suppliers: [] as string[],
    addressId: '',
  };

  let categoryId = '';
  /** Created in Admin; never touched by Inventory, so it has no inventory row. */
  let rowlessId = '';
  /** Created in Admin, then switched to TRACKED by Inventory. */
  let trackedId = '';
  /** Created in Admin, explicitly UNTRACKED (row exists). */
  let untrackedId = '';
  /** Created in Admin, then marked unavailable in Admin. */
  let unavailableId = '';
  /** Created in Admin, then deactivated in Admin. */
  let inactiveId = '';

  async function createProduct(suffix: string, name: string, extra: object = {}) {
    const res = await asAdmin(request(app).post('/api/v1/admin/products')).send({
      category_id: categoryId,
      name,
      sku: `${SKU_PREFIX}${suffix}`,
      unit: '1 pc',
      purchase_cost: 100,
      is_available: true,
      is_active: true,
      ...extra,
    });
    expect(res.status).toBe(201);
    created.products.push(res.body.data.product.id);
    return res.body.data.product.id as string;
  }

  async function placeOrder(productId: string, quantity: number) {
    const res = await asCustomer(request(app).post('/api/v1/orders')).send({
      address_id: created.addressId,
      items: [{ product_id: productId, quantity }],
    });
    expect(res.status).toBe(201);
    const orderId = res.body.data.order.id as string;
    created.orders.push(orderId);
    const item = await pool.query('SELECT id FROM order_items WHERE order_id = $1', [orderId]);
    return { orderId, itemId: item.rows[0].id as string };
  }

  const inventoryRowCount = async (productId: string) =>
    Number((await pool.query('SELECT count(*) FROM inventory WHERE product_id = $1', [productId])).rows[0].count);

  const listInventory = (query: Record<string, string>) =>
    asStaff(request(app).get('/api/v1/admin/inventory')).query(query);

  beforeAll(async () => {
    await pool.query(
      `DELETE FROM inventory WHERE product_id IN (SELECT id FROM products WHERE sku LIKE $1)`,
      [`${SKU_PREFIX}%`]
    );
    await pool.query('DELETE FROM products WHERE sku LIKE $1', [`${SKU_PREFIX}%`]);

    const cat = await pool.query(
      'SELECT id FROM categories WHERE is_active = true ORDER BY display_order LIMIT 1'
    );
    categoryId = cat.rows[0].id;

    const addr = await pool.query(
      `INSERT INTO customer_addresses (user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default)
       VALUES ($1, 'Inventory contract test', 'Test Recipient', '+94771234567', 'No. 1, Test Lane', 'Dharga Town', 6.4351, 80.0243, false)
       RETURNING id`,
      [customer.id]
    );
    created.addressId = addr.rows[0].id;

    rowlessId = await createProduct('ROWLESS', 'Invapp Rowless Yoghurt');
    trackedId = await createProduct('TRACKED', 'Invapp Tracked Rice 5kg');
    untrackedId = await createProduct('UNTRACKED', 'Invapp Untracked Bread');
    unavailableId = await createProduct('UNAVAIL', 'Invapp Unavailable Juice', { is_available: false });
    inactiveId = await createProduct('INACTIVE', 'Invapp Inactive Soap', { is_active: false });

    for (const [id, mode] of [[trackedId, 'TRACKED'], [untrackedId, 'UNTRACKED']] as const) {
      const res = await asAdmin(request(app).patch(`/api/v1/admin/inventory/${id}/mode`)).send({
        tracking_mode: mode,
      });
      expect(res.status).toBe(200);
    }
  });

  afterAll(async () => {
    if (created.orders.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created.orders]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created.orders]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created.orders]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created.orders]);
    }
    if (created.products.length) {
      await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [created.products]);
      await pool.query('DELETE FROM products WHERE id = ANY($1)', [created.products]);
    }
    if (created.suppliers.length) {
      await pool.query('DELETE FROM suppliers WHERE id = ANY($1)', [created.suppliers]);
    }
    if (created.addressId) {
      await pool.query('DELETE FROM customer_addresses WHERE id = $1', [created.addressId]);
    }
  });

  // ==========================================================================
  // G1 — every catalog product is visible to Inventory
  // ==========================================================================
  describe('G1: stock list covers the whole catalog', () => {
    it('lists a product created in Admin that has no inventory row, as UNTRACKED with zero stock', async () => {
      expect(await inventoryRowCount(rowlessId)).toBe(0);

      const res = await listInventory({ search: `${SKU_PREFIX}ROWLESS` });

      expect(res.status).toBe(200);
      const row = res.body.data.inventory.find((r: { product_id: string }) => r.product_id === rowlessId);
      expect(row).toMatchObject({
        product_name: 'Invapp Rowless Yoghurt',
        product_sku: `${SKU_PREFIX}ROWLESS`,
        inventory_id: null,
        tracking_mode: 'UNTRACKED',
        quantity_on_hand: 0,
        quantity_reserved: 0,
        quantity_available: 0,
        is_low_stock: false,
        is_active: true,
        is_available: true,
      });
    });

    it('reading the list never creates inventory rows', async () => {
      await listInventory({ search: SKU_PREFIX });
      expect(await inventoryRowCount(rowlessId)).toBe(0);
    });

    it('carries Admin-owned availability read-only, so Inventory can flag "orderable but out of stock"', async () => {
      const res = await listInventory({ search: SKU_PREFIX });
      const byId = new Map(res.body.data.inventory.map((r: { product_id: string }) => [r.product_id, r]));
      expect(byId.get(unavailableId)).toMatchObject({ is_available: false });
      expect(byId.get(trackedId)).toMatchObject({ is_available: true, tracking_mode: 'TRACKED' });
    });

    it('searches by name and by SKU, case-insensitively', async () => {
      const byName = await listInventory({ search: 'invapp tracked rice' });
      expect(byName.body.data.inventory.map((r: { product_id: string }) => r.product_id)).toEqual([trackedId]);

      const bySku = await listInventory({ search: `${SKU_PREFIX.toLowerCase()}untracked` });
      expect(bySku.body.data.inventory.map((r: { product_id: string }) => r.product_id)).toEqual([untrackedId]);
    });

    it('hides inactive products unless include_inactive=true, and counts row-less products in pagination', async () => {
      const active = await listInventory({ search: SKU_PREFIX });
      const ids = active.body.data.inventory.map((r: { product_id: string }) => r.product_id);
      expect(ids).not.toContain(inactiveId);
      expect(active.body.data.pagination.total).toBe(4);

      const all = await listInventory({ search: SKU_PREFIX, include_inactive: 'true' });
      expect(all.body.data.pagination.total).toBe(5);
      const inactive = all.body.data.inventory.find((r: { product_id: string }) => r.product_id === inactiveId);
      expect(inactive).toMatchObject({ is_active: false });
    });

    it('low_stock_only returns tracked products only', async () => {
      const res = await listInventory({ search: SKU_PREFIX, low_stock_only: 'true' });
      expect(res.body.data.inventory.map((r: { product_id: string }) => r.product_id)).toEqual([trackedId]);
    });

    it('is refused to a customer', async () => {
      const res = await asCustomer(request(app).get('/api/v1/admin/inventory'));
      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // D3 — manual adjustment rules
  // ==========================================================================
  describe('D3: manual adjustments', () => {
    const adjust = (productId: string, body: object, token = tokenAdmin) =>
      as(token)(request(app).post(`/api/v1/admin/inventory/${productId}/adjust`)).send(body);

    it('restocks a tracked product', async () => {
      const res = await adjust(trackedId, { adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 20, notes: 'Contract test restock' });
      expect(res.status).toBe(200);
      expect(res.body.data.inventory.quantity_on_hand).toBe(20);
    });

    it('writes off damage (negative) and applies an audit correction in either direction', async () => {
      expect((await adjust(trackedId, { adjustment_type: 'DAMAGE_WRITE_OFF', quantity_delta: -2, notes: 'Torn bag' })).status).toBe(200);
      expect((await adjust(trackedId, { adjustment_type: 'INVENTORY_AUDIT_ADJUSTMENT', quantity_delta: -1, notes: 'Count' })).status).toBe(200);
      const up = await adjust(trackedId, { adjustment_type: 'INVENTORY_AUDIT_ADJUSTMENT', quantity_delta: 3, notes: 'Recount' });
      expect(up.status).toBe(200);
      expect(up.body.data.inventory.quantity_on_hand).toBe(20);
    });

    it.each(['ORDER_RESERVATION', 'ORDER_FULFILLMENT', 'ORDER_CANCELLATION_RESTORE'])(
      'rejects the system-only type %s',
      async (type) => {
        const res = await adjust(trackedId, { adjustment_type: type, quantity_delta: -1 });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    );

    it('rejects a negative restock and a positive write-off', async () => {
      const restock = await adjust(trackedId, { adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: -5 });
      expect(restock.status).toBe(400);
      expect(restock.body.error.code).toBe('VALIDATION_ERROR');

      const writeOff = await adjust(trackedId, { adjustment_type: 'DAMAGE_WRITE_OFF', quantity_delta: 5 });
      expect(writeOff.status).toBe(400);
      expect(writeOff.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses an untracked product and leaves its stock and ledger untouched', async () => {
      const before = await pool.query(
        `SELECT inv.quantity_on_hand, (SELECT count(*) FROM inventory_adjustments a WHERE a.inventory_id = inv.id) AS n
           FROM inventory inv WHERE inv.product_id = $1`,
        [untrackedId]
      );

      const res = await adjust(untrackedId, { adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 10 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PRODUCT_NOT_TRACKED');
      const after = await pool.query(
        `SELECT inv.quantity_on_hand, (SELECT count(*) FROM inventory_adjustments a WHERE a.inventory_id = inv.id) AS n
           FROM inventory inv WHERE inv.product_id = $1`,
        [untrackedId]
      );
      expect(after.rows[0]).toEqual(before.rows[0]);
    });

    it('refuses a product with no inventory row and does not create one', async () => {
      const res = await adjust(rowlessId, { adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 10 });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PRODUCT_NOT_TRACKED');
      expect(await inventoryRowCount(rowlessId)).toBe(0);
    });

    it('is still ADMIN-only', async () => {
      const res = await adjust(trackedId, { adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 1 }, tokenStaff);
      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // B1 — no double sourcing
  // ==========================================================================
  describe('B1: an order item is sourced once', () => {
    const source = (orderId: string, itemId: string, cost: number, token = tokenStaff) =>
      as(token)(request(app).post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`)).send({
        actual_unit_cost: cost,
      });

    const sourcingRecords = async (itemId: string) =>
      Number((await pool.query('SELECT count(*) FROM sourcing_records WHERE order_item_id = $1', [itemId])).rows[0].count);
    const onHand = async (productId: string) =>
      (await pool.query('SELECT quantity_on_hand FROM inventory WHERE product_id = $1 AND dark_store_id = $2', [productId, STORE])).rows[0].quantity_on_hand;

    it('refuses a second sourcing of the same item, keeping one record and one stock decrement', async () => {
      const stockBefore = await onHand(trackedId);
      const { orderId, itemId } = await placeOrder(trackedId, 2);

      const first = await source(orderId, itemId, 95);
      expect(first.status).toBe(200);
      const second = await source(orderId, itemId, 97, tokenAdmin);

      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe('ITEM_ALREADY_SOURCED');
      expect(await sourcingRecords(itemId)).toBe(1);
      expect(await onHand(trackedId)).toBe(stockBefore - 2);
      const item = await pool.query('SELECT actual_unit_cost FROM order_items WHERE id = $1', [itemId]);
      expect(Number(item.rows[0].actual_unit_cost)).toBe(95);
    });

    it('lets exactly one of two simultaneous submissions through', async () => {
      const { orderId, itemId } = await placeOrder(untrackedId, 1);

      const results = await Promise.all([source(orderId, itemId, 101), source(orderId, itemId, 102, tokenAdmin)]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await sourcingRecords(itemId)).toBe(1);
    });
  });

  // ==========================================================================
  // G2 — cross-product ledger
  // ==========================================================================
  describe('G2: adjustment ledger', () => {
    const ledger = (query: Record<string, string>, token = tokenStaff) =>
      as(token)(request(app).get('/api/v1/admin/inventory/adjustments')).query(query);

    it('returns adjustments newest first with product and actor names', async () => {
      const res = await ledger({ product_id: trackedId });

      expect(res.status).toBe(200);
      const rows = res.body.data.adjustments;
      // restock, write-off, audit −1, audit +3, then the B1 sourcing fulfilment
      expect(rows.map((r: { adjustment_type: string }) => r.adjustment_type)).toEqual([
        'ORDER_FULFILLMENT',
        'INVENTORY_AUDIT_ADJUSTMENT',
        'INVENTORY_AUDIT_ADJUSTMENT',
        'DAMAGE_WRITE_OFF',
        'PURCHASE_RESTOCK',
      ]);
      expect(rows[4]).toMatchObject({
        product_id: trackedId,
        product_name: 'Invapp Tracked Rice 5kg',
        product_sku: `${SKU_PREFIX}TRACKED`,
        quantity_delta: 20,
        previous_quantity: 0,
        new_quantity: 20,
        notes: 'Contract test restock',
        created_by_user_id: admin.id,
        actor_name: 'Nawaz Mansoor',
      });
      expect(rows[0].actor_name).toBe('Kasun Perera');
      expect(res.body.data.pagination).toMatchObject({ page: 1, total: 5 });
    });

    it('filters by type and paginates', async () => {
      const audits = await ledger({ product_id: trackedId, type: 'INVENTORY_AUDIT_ADJUSTMENT' });
      expect(audits.body.data.adjustments).toHaveLength(2);

      const page2 = await ledger({ product_id: trackedId, limit: '2', page: '2' });
      expect(page2.body.data.adjustments).toHaveLength(2);
      expect(page2.body.data.pagination).toMatchObject({ page: 2, limit: 2, total: 5, total_pages: 3 });
    });

    it('filters by date range', async () => {
      const future = await ledger({ product_id: trackedId, from: '2999-01-01T00:00:00Z' });
      expect(future.body.data.adjustments).toHaveLength(0);
      const past = await ledger({ product_id: trackedId, to: '2000-01-01T00:00:00Z' });
      expect(past.body.data.adjustments).toHaveLength(0);
    });

    it('rejects a malformed filter and is refused to a customer', async () => {
      expect((await ledger({ product_id: 'not-a-uuid' })).status).toBe(400);
      expect((await ledger({ product_id: trackedId }, tokenCustomer)).status).toBe(403);
    });
  });

  // ==========================================================================
  // Malformed ids are the caller's mistake (400), not a server error (500)
  // ==========================================================================
  describe('malformed product ids and store ids', () => {
    it.each([
      ['GET', '/api/v1/admin/inventory/not-a-uuid', undefined],
      ['PATCH', '/api/v1/admin/inventory/not-a-uuid/mode', { tracking_mode: 'TRACKED' }],
      ['POST', '/api/v1/admin/inventory/not-a-uuid/adjust', { adjustment_type: 'PURCHASE_RESTOCK', quantity_delta: 1 }],
    ])('%s %s answers 400 VALIDATION_ERROR', async (method, url, body) => {
      const req = asAdmin(
        method === 'GET' ? request(app).get(url) : method === 'PATCH' ? request(app).patch(url) : request(app).post(url)
      );
      const res = body ? await req.send(body) : await req;
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects a malformed dark_store_id on the product stock endpoint', async () => {
      const res = await asAdmin(request(app).get(`/api/v1/admin/inventory/${trackedId}`)).query({
        dark_store_id: 'bad',
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('still answers 404 for a well-formed id that does not exist', async () => {
      const res = await asAdmin(request(app).get('/api/v1/admin/inventory/00000000-0000-0000-0000-000000000000'));
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('PRODUCT_NOT_FOUND');
    });
  });

  // ==========================================================================
  // Sourcing detail lists items in a stable, documented order
  // ==========================================================================
  describe('sourcing detail item order', () => {
    it('orders items by created time, then product name, then id - the same on every call', async () => {
      // Items of one order share created_at, so without a tiebreak Postgres
      // may return them in any order. Listed Pelwatte-first on purpose so
      // insertion order and the expected (name) order disagree.
      const res = await asCustomer(request(app).post('/api/v1/orders')).send({
        address_id: created.addressId,
        items: [
          { product_id: 'b0000001-0000-0000-0000-000000000002', quantity: 1 }, // Pelwatte Salted Butter 200g
          { product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }, // Kotmale Fresh Milk 1L
        ],
      });
      expect(res.status).toBe(201);
      const orderId = res.body.data.order.id as string;
      created.orders.push(orderId);

      const names = async () =>
        (await asStaff(request(app).get(`/api/v1/admin/orders/${orderId}/sourcing`))).body.data.items.map(
          (it: { product_name_snapshot: string }) => it.product_name_snapshot
        );

      const first = await names();
      expect(first).toEqual(['Kotmale Fresh Milk 1L', 'Pelwatte Salted Butter 200g']);
      for (let i = 0; i < 4; i++) expect(await names()).toEqual(first);
    });
  });

  // ==========================================================================
  // G4 — supplier code conflicts
  // ==========================================================================
  describe('G4: supplier code uniqueness', () => {
    const code = `SUP-INVAPP-${Date.now()}`;

    it('answers a duplicate code with 409 SUPPLIER_CODE_TAKEN on create and on update', async () => {
      const first = await asAdmin(request(app).post('/api/v1/admin/suppliers')).send({ name: 'Invapp Supplier One', code });
      expect(first.status).toBe(201);
      created.suppliers.push(first.body.data.supplier.id);

      const dup = await asAdmin(request(app).post('/api/v1/admin/suppliers')).send({ name: 'Invapp Supplier Two', code });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('SUPPLIER_CODE_TAKEN');

      const other = await asAdmin(request(app).post('/api/v1/admin/suppliers')).send({ name: 'Invapp Supplier Three', code: `${code}-B` });
      created.suppliers.push(other.body.data.supplier.id);
      const clash = await asAdmin(request(app).patch(`/api/v1/admin/suppliers/${other.body.data.supplier.id}`)).send({ code });
      expect(clash.status).toBe(409);
      expect(clash.body.error.code).toBe('SUPPLIER_CODE_TAKEN');
    });
  });

  // ==========================================================================
  // Customer safety — nothing internal leaks after inventory activity
  // ==========================================================================
  describe('customer payloads stay free of internal data', () => {
    const FORBIDDEN = [
      'purchase_cost', 'custom_markup_percent', 'effective_markup_percent', 'estimated_unit_cost',
      'actual_unit_cost', 'markup_percentage_applied', 'supplier', 'supplier_id', 'supplier_name',
      'sourcing_records', 'tracking_mode', 'quantity_on_hand', 'quantity_reserved', 'quantity_available',
      'low_stock_threshold', 'adjustments', 'inventory_id',
    ];
    const keysDeep = (value: unknown, out = new Set<string>()): Set<string> => {
      if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out));
      else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
          out.add(k);
          keysDeep(v, out);
        }
      }
      return out;
    };
    const expectClean = (body: unknown) => {
      const keys = keysDeep(body);
      expect(FORBIDDEN.filter((k) => keys.has(k))).toEqual([]);
    };

    it('catalog list, search and detail', async () => {
      expectClean((await request(app).get('/api/v1/catalog/products').query({ limit: 100 })).body);
      expectClean((await request(app).get('/api/v1/catalog/products').query({ search: 'Invapp' })).body);
      expectClean((await request(app).get(`/api/v1/catalog/products/${trackedId}`)).body);
    });

    it('the customer’s own orders, including one that was sourced from tracked stock', async () => {
      const sourcedOrderId = created.orders[0];
      expectClean((await asCustomer(request(app).get('/api/v1/orders'))).body);
      expectClean((await asCustomer(request(app).get(`/api/v1/orders/${sourcedOrderId}`))).body);
    });
  });
});
