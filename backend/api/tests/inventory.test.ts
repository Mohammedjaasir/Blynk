import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

describe('Stage 6 — Inventory & Sourcing Subsystem', () => {
  const app = createApp();

  // Test Actors
  const customerUser = {
    id: 'a0000001-0000-0000-0000-000000000001',
    phone: '+94771234567',
    role: 'CUSTOMER' as const,
  };
  const tokenCustomer = generateAccessToken(customerUser);

  const packingStaffUser = {
    id: 'a0000001-0000-0000-0000-000000000004',
    phone: '+94774443322',
    role: 'PACKING_STAFF' as const,
  };
  const tokenStaff = generateAccessToken(packingStaffUser);

  const adminUser = {
    id: 'a0000001-0000-0000-0000-000000000003',
    phone: '+94775551122',
    role: 'ADMIN' as const,
  };
  const tokenAdmin = generateAccessToken(adminUser);

  const riderUser = {
    id: 'a0000001-0000-0000-0000-000000000002',
    phone: '+94779876543',
    role: 'RIDER' as const,
  };
  const tokenRider = generateAccessToken(riderUser);

  let addressId: string;
  let testOrderId: string;
  let testOrderItem1Id: string;
  let testOrderItem2Id: string;
  let testSupplierId: string;

  /**
   * An order with one PENDING item. An item can be sourced only once
   * (ITEM_ALREADY_SOURCED), so tests that need to reach a sourcing rule other
   * than that one use a fresh item instead of re-sourcing a shared one.
   */
  async function placeFreshOrder(productId = 'b0000001-0000-0000-0000-000000000001', quantity = 1) {
    const orderRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenCustomer}`)
      .send({ address_id: addressId, items: [{ product_id: productId, quantity }] });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.data.order.id as string;
    const itemRes = await pool.query('SELECT id FROM order_items WHERE order_id = $1', [orderId]);
    return { orderId, itemId: itemRes.rows[0].id as string };
  }

  let runStartedAt: Date;

  beforeAll(async () => {
    // 0. Everything the customer orders from here on belongs to this file
    // (test files run one at a time), so afterAll can remove exactly that.
    runStartedAt = (await pool.query('SELECT now() AS t')).rows[0].t;

    // 1. Ensure customer address exists
    const addrRes = await pool.query(`
      INSERT INTO customer_addresses (
        user_id, label, recipient_name, recipient_phone, address_line1, city, latitude, longitude, is_default
      ) VALUES (
        '${customerUser.id}', 'Home', 'Ahmed Rizvi', '+94771234567',
        'No. 18, Marikar Street', 'Dharga Town', 6.435100, 80.024300, true
      ) RETURNING id;
    `);
    addressId = addrRes.rows[0].id;

    // 2. Query seeded supplier
    const supRes = await pool.query(`
      SELECT id FROM suppliers WHERE code = 'SUP-DHARGA-MAIN' LIMIT 1;
    `);
    testSupplierId = supRes.rows[0]?.id;

    // 3. Create a fresh test order with 2 items
    // Product 1: Kotmale Fresh Milk 1L (cost 450, price 540)
    // Product 2: Pelwatte Butter 200g (cost 700, price 805)
    const orderRes = await request(app)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${tokenCustomer}`)
      .send({
        address_id: addressId,
        items: [
          { product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 2 },
          { product_id: 'b0000001-0000-0000-0000-000000000002', quantity: 1 },
        ],
      });

    expect(orderRes.status).toBe(201);
    testOrderId = orderRes.body.data.order.id;

    // Retrieve order items directly from DB to get IDs
    const itemsRes = await pool.query(
      `SELECT id, product_id, estimated_unit_cost, actual_unit_cost, unit_selling_price FROM order_items WHERE order_id = $1 ORDER BY created_at ASC`,
      [testOrderId]
    );
    testOrderItem1Id = itemsRes.rows[0].id;
    testOrderItem2Id = itemsRes.rows[1].id;
  });

  // Remove the orders and address this file created. Earlier runs left them
  // behind (11 orders per run). Stock and ledger state is left as before.
  afterAll(async () => {
    const created = (
      await pool.query('SELECT id FROM orders WHERE customer_id = $1 AND created_at >= $2', [
        customerUser.id,
        runStartedAt,
      ])
    ).rows.map((r) => r.id as string);
    if (created.length) {
      await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [created]);
      await pool.query('DELETE FROM orders WHERE id = ANY($1)', [created]);
    }
    if (addressId) await pool.query('DELETE FROM customer_addresses WHERE id = $1', [addressId]);
  });

  // ==========================================================================
  // 1. ORDER ITEM SOURCING & COST INTEGRITY
  // ==========================================================================
  describe('Sourcing Workflow & Cost Integrity', () => {
    it('sources an item with actual procurement cost and supplier', async () => {
      // Estimated cost: 450.00 LKR
      // Actual procurement purchase cost: 460.00 LKR
      const res = await request(app)
        .post(`/api/v1/admin/orders/${testOrderId}/items/${testOrderItem1Id}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({
          quantity: 2,
          actual_unit_cost: 460.0,
          supplier_id: testSupplierId,
          notes: 'Procured fresh batch from local grocery',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.item.id).toBe(testOrderItem1Id);

      // Verify Critical Invariant: actual_unit_cost is updated
      expect(res.body.data.item.actual_unit_cost).toBe(460.0);

      // Verify Critical Invariant: estimated_unit_cost remains UNTOUCHED
      expect(res.body.data.item.estimated_unit_cost).toBe(450.0);

      // Verify Critical Invariant: unit_selling_price remains UNTOUCHED
      expect(res.body.data.item.unit_selling_price).toBe(540.0);

      // Verify item status updated to SOURCED
      expect(res.body.data.item.item_status).toBe('SOURCED');

      // Verify sourcing record creation
      expect(res.body.data.sourcing_record).toBeDefined();
      expect(res.body.data.sourcing_record.actual_unit_cost).toBe(460.0);
      expect(res.body.data.sourcing_record.estimated_unit_cost).toBe(450.0);
      expect(res.body.data.sourcing_record.supplier_id).toBe(testSupplierId);
      expect(res.body.data.sourcing_record.sourced_by_user_id).toBe(packingStaffUser.id);
    });

    it('persists changes in the database and preserves historical order totals', async () => {
      const dbItemRes = await pool.query(
        `SELECT * FROM order_items WHERE id = $1`,
        [testOrderItem1Id]
      );
      const row = dbItemRes.rows[0];

      expect(Number(row.actual_unit_cost)).toBe(460.0);
      expect(Number(row.estimated_unit_cost)).toBe(450.0);
      expect(Number(row.unit_selling_price)).toBe(540.0);
      expect(row.item_status).toBe('SOURCED');

      // Verify order totals remain unchanged (2 * 540 + 1 * 805 + 70 = 1955 LKR)
      const dbOrderRes = await pool.query(
        `SELECT subtotal_amount, total_amount FROM orders WHERE id = $1`,
        [testOrderId]
      );
      expect(Number(dbOrderRes.rows[0].total_amount)).toBe(1955.0);
    });

    it('allows providing supplier_name on-the-fly when supplier_id is omitted', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${testOrderId}/items/${testOrderItem2Id}/source`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          actual_unit_cost: 695.5,
          supplier_name: 'Al-Hasan Fresh Mart',
          notes: 'Discounted wholesale rate',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.item.actual_unit_cost).toBe(695.5);
      expect(res.body.data.item.estimated_unit_cost).toBe(700.0);
      expect(res.body.data.item.unit_selling_price).toBe(805.0);
      expect(res.body.data.item.item_status).toBe('SOURCED');
    });

    it('returns full order sourcing details via GET /admin/orders/:id/sourcing', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/orders/${testOrderId}/sourcing`)
        .set('Authorization', `Bearer ${tokenStaff}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.order_id).toBe(testOrderId);
      expect(res.body.data.metrics.total_items).toBe(2);
      expect(res.body.data.metrics.sourced_items).toBe(2);
      expect(res.body.data.metrics.is_sourcing_complete).toBe(true);

      // Look the item up by id: both items were inserted in one transaction,
      // share a created_at, and so come back in no guaranteed order.
      const item1 = res.body.data.items.find((it: { id: string }) => it.id === testOrderItem1Id);
      expect(item1.sourcing_records.length).toBeGreaterThan(0);
      expect(item1.sourcing_records[0].actual_unit_cost).toBe(460.0);
    });
  });

  // ==========================================================================
  // 2. VALIDATION & IDOR DEFENSE
  // ==========================================================================
  describe('Sourcing Validation & IDOR Protection', () => {
    it('rejects sourcing for non-existent order with 404 or 400', async () => {
      const fakeOrderId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/admin/orders/${fakeOrderId}/items/${testOrderItem1Id}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ actual_unit_cost: 450.0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_ITEM_MISMATCH');
    });

    it('rejects sourcing for non-existent item with 404', async () => {
      const fakeItemId = '00000000-0000-0000-0000-000000000000';
      const res = await request(app)
        .post(`/api/v1/admin/orders/${testOrderId}/items/${fakeItemId}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ actual_unit_cost: 450.0 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ORDER_ITEM_NOT_FOUND');
    });

    it('prevents IDOR: rejects item that does not belong to the specified order with 400', async () => {
      // Create a second order
      const secondOrderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          address_id: addressId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000004', quantity: 1 }],
        });
      const secondOrderId = secondOrderRes.body.data.order.id;

      // Attempt to source item 1 using secondOrderId
      const res = await request(app)
        .post(`/api/v1/admin/orders/${secondOrderId}/items/${testOrderItem1Id}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ actual_unit_cost: 450.0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_ITEM_MISMATCH');
    });

    it('rejects negative actual procurement cost with 400 validation error', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${testOrderId}/items/${testOrderItem1Id}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ actual_unit_cost: -50.0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid or non-existent supplier_id with 404', async () => {
      const fakeSupplierId = '00000000-0000-0000-0000-000000000000';
      const { orderId, itemId } = await placeFreshOrder();
      const res = await request(app)
        .post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({
          actual_unit_cost: 450.0,
          supplier_id: fakeSupplierId,
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('rejects quantity greater than ordered quantity with 400', async () => {
      const { orderId, itemId } = await placeFreshOrder();
      const res = await request(app)
        .post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({
          quantity: 99,
          actual_unit_cost: 450.0,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_SOURCING_QUANTITY');
    });
  });

  // ==========================================================================
  // 3. UNAVAILABLE ITEM INTEGRATION
  // ==========================================================================
  describe('Out-of-Stock / Item Unavailable Integration', () => {
    let unavailOrderId: string;
    let unavailItemId: string;

    beforeAll(async () => {
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          address_id: addressId,
          items: [
            { product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }, // 540 LKR
            { product_id: 'b0000001-0000-0000-0000-000000000005', quantity: 1 }, // 300 LKR
          ],
        });
      unavailOrderId = orderRes.body.data.order.id;

      const itemsRes = await pool.query(
        `SELECT id FROM order_items WHERE order_id = $1 AND product_id = 'b0000001-0000-0000-0000-000000000005'`,
        [unavailOrderId]
      );
      unavailItemId = itemsRes.rows[0].id;
    });

    it('resolves unavailable item via canonical POST /admin/orders/:id/resolve-item', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${unavailOrderId}/resolve-item`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({
          item_id: unavailItemId,
          item_status: 'UNAVAILABLE',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.order.order_status).toBe('ITEM_UNAVAILABLE');

      // Verify subtotal updated to exclude unavailable item: 540 + 70 delivery = 610 LKR
      expect(res.body.data.order.subtotal_amount).toBe(540.0);
      expect(res.body.data.order.total_amount).toBe(610.0);

      // Verify actual_unit_cost remains strictly NULL for unavailable item
      const dbItemRes = await pool.query(
        `SELECT actual_unit_cost, item_status FROM order_items WHERE id = $1`,
        [unavailItemId]
      );
      expect(dbItemRes.rows[0].actual_unit_cost).toBeNull();
      expect(dbItemRes.rows[0].item_status).toBe('UNAVAILABLE');

      // Verify Stage 5 notification outbox enqueued ITEM_UNAVAILABLE notification
      const notifRes = await pool.query(
        `SELECT * FROM notifications WHERE order_id = $1 AND notification_type = 'ITEM_UNAVAILABLE'`,
        [unavailOrderId]
      );
      expect(notifRes.rows.length).toBeGreaterThan(0);
      expect(notifRes.rows[0].status).toBe('QUEUED');
    });

    it('rejects sourcing an item that was marked UNAVAILABLE', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${unavailOrderId}/items/${unavailItemId}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ actual_unit_cost: 250.0 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('CANNOT_SOURCE_UNAVAILABLE_ITEM');
    });
  });

  // ==========================================================================
  // 4. RBAC & SECURITY
  // ==========================================================================
  describe('RBAC & Operational Security', () => {
    it('blocks CUSTOMER role from sourcing with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${testOrderId}/items/${testOrderItem1Id}/source`)
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({ actual_unit_cost: 450.0 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('blocks RIDER role from sourcing with 403 Forbidden', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${testOrderId}/items/${testOrderItem1Id}/source`)
        .set('Authorization', `Bearer ${tokenRider}`)
        .send({ actual_unit_cost: 450.0 });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('blocks unauthenticated requests with 401 Unauthorized', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${testOrderId}/items/${testOrderItem1Id}/source`)
        .send({ actual_unit_cost: 450.0 });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('allows PACKING_STAFF to source items', async () => {
      const { orderId, itemId } = await placeFreshOrder();
      const res = await request(app)
        .post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({ actual_unit_cost: 455.0 });

      expect(res.status).toBe(200);
      expect(res.body.data.item.actual_unit_cost).toBe(455.0);
    });

    it('allows ADMIN to source items', async () => {
      const { orderId, itemId } = await placeFreshOrder();
      const res = await request(app)
        .post(`/api/v1/admin/orders/${orderId}/items/${itemId}/source`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ actual_unit_cost: 458.0 });

      expect(res.status).toBe(200);
      expect(res.body.data.item.actual_unit_cost).toBe(458.0);
    });
  });

  // ==========================================================================
  // 5. CUSTOMER DATA PROTECTION
  // ==========================================================================
  describe('Customer Data Protection (No Cost Leakage)', () => {
    it('customer GET /api/v1/orders/:id never exposes estimated_unit_cost, actual_unit_cost, or markup', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${testOrderId}`)
        .set('Authorization', `Bearer ${tokenCustomer}`);

      expect(res.status).toBe(200);
      const items = res.body.data.order.items;
      expect(items.length).toBeGreaterThan(0);

      for (const it of items) {
        expect(it.estimated_unit_cost).toBeUndefined();
        expect(it.actual_unit_cost).toBeUndefined();
        expect(it.markup_percentage_applied).toBeUndefined();

        // Customer retail fields are visible
        expect(it.unit_selling_price).toBeDefined();
        expect(it.subtotal).toBeDefined();
        expect(it.quantity).toBeDefined();
        expect(it.product_name_snapshot).toBeDefined();
      }
    });

    it('customer GET /api/v1/orders list never exposes internal costs or markups', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`);

      expect(res.status).toBe(200);
      const orders = res.body.data.orders;
      expect(orders.length).toBeGreaterThan(0);

      for (const o of orders) {
        expect((o as any).purchase_cost).toBeUndefined();
        expect((o as any).actual_cost).toBeUndefined();
        expect((o as any).markup).toBeUndefined();
        if (o.items) {
          for (const it of o.items) {
            expect(it.estimated_unit_cost).toBeUndefined();
            expect(it.actual_unit_cost).toBeUndefined();
            expect(it.markup_percentage_applied).toBeUndefined();
          }
        }
      }
    });

    it('customer POST /api/v1/orders response never leaks internal costs', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          address_id: addressId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });

      expect(res.status).toBe(201);
      const items = res.body.data.order.items;
      for (const it of items) {
        expect(it.estimated_unit_cost).toBeUndefined();
        expect(it.actual_unit_cost).toBeUndefined();
        expect(it.markup_percentage_applied).toBeUndefined();
      }
    });
  });

  // ==========================================================================
  // 6. TRACKED INVENTORY & LEDGER
  // ==========================================================================
  describe('Tracked Inventory & Stock Ledger', () => {
    // A product of this file's own, created through Admin and removed with its
    // inventory row and ledger afterwards. Seeded products and their stock are
    // never touched (plan Task 7: this block used to reset the seeded Munchee
    // row by direct UPDATE and leave it TRACKED with two ledger rows per run).
    const SKU_PREFIX = 'TEST-SKU-INVLEDGER-';
    let trackedProductId = '';
    const storeId = '018dc3f0-4a82-789a-8b1b-947f61ad8821';

    async function removeTestProducts() {
      const products = (await pool.query('SELECT id FROM products WHERE sku LIKE $1', [`${SKU_PREFIX}%`])).rows.map((r) => r.id);
      if (!products.length) return;
      const orders = (await pool.query('SELECT DISTINCT order_id FROM order_items WHERE product_id = ANY($1)', [products])).rows.map(
        (r) => r.order_id
      );
      if (orders.length) {
        await pool.query('DELETE FROM notifications WHERE order_id = ANY($1)', [orders]);
        await pool.query('DELETE FROM payments WHERE order_id = ANY($1)', [orders]);
        await pool.query('DELETE FROM deliveries WHERE order_id = ANY($1)', [orders]);
        await pool.query('DELETE FROM orders WHERE id = ANY($1)', [orders]);
      }
      await pool.query('DELETE FROM inventory WHERE product_id = ANY($1)', [products]); // ledger rows cascade
      await pool.query('DELETE FROM products WHERE id = ANY($1)', [products]);
    }

    beforeAll(async () => {
      await removeTestProducts();
      const category = (await pool.query('SELECT id FROM categories WHERE is_active = true ORDER BY display_order LIMIT 1')).rows[0].id;
      const res = await request(app)
        .post('/api/v1/admin/products')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          category_id: category,
          name: 'Ledger Test Crackers 490g',
          sku: `${SKU_PREFIX}${Date.now()}`,
          unit: '490 g',
          purchase_cost: 330,
          is_available: true,
          is_active: true,
        });
      expect(res.status).toBe(201);
      trackedProductId = res.body.data.product.id;
    });

    afterAll(removeTestProducts);

    it('switches product inventory tracking mode to TRACKED', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/inventory/${trackedProductId}/mode`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          tracking_mode: 'TRACKED',
          dark_store_id: storeId,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.tracking_mode).toBe('TRACKED');
    });

    it('adjusts stock atomically and appends an immutable ledger record', async () => {
      // Restock 50 units
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${trackedProductId}/adjust`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          adjustment_type: 'PURCHASE_RESTOCK',
          quantity_delta: 50,
          dark_store_id: storeId,
          notes: 'Received distributor carton',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.inventory.quantity_on_hand).toBe(50);
      expect(res.body.data.inventory.quantity_available).toBe(50);
      expect(res.body.data.adjustment.adjustment_type).toBe('PURCHASE_RESTOCK');
      expect(res.body.data.adjustment.quantity_delta).toBe(50);
      expect(res.body.data.adjustment.created_by_user_id).toBe(adminUser.id);
    });

    it('retrieves product inventory and historical adjustment ledger', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/inventory/${trackedProductId}?dark_store_id=${storeId}`)
        .set('Authorization', `Bearer ${tokenStaff}`);

      expect(res.status).toBe(200);
      expect(res.body.data.product_id).toBe(trackedProductId);
      expect(res.body.data.tracking_mode).toBe('TRACKED');
      expect(res.body.data.quantity_on_hand).toBe(50);
      expect(res.body.data.adjustments.length).toBeGreaterThan(0);
      expect(res.body.data.adjustments[0].adjustment_type).toBe('PURCHASE_RESTOCK');
    });

    it('rejects stock adjustment that would result in negative inventory', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/inventory/${trackedProductId}/adjust`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          adjustment_type: 'DAMAGE_WRITE_OFF',
          quantity_delta: -9999, // On hand is 50
          dark_store_id: storeId,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('NEGATIVE_INVENTORY_PROHIBITED');
    });

    it('enforces database check constraint chk_inv_qty_available', async () => {
      // Attempt direct DB update where reserved > on_hand
      await expect(
        pool.query(`
          UPDATE inventory 
          SET quantity_reserved = 100, quantity_on_hand = 10 
          WHERE product_id = '${trackedProductId}' AND dark_store_id = '${storeId}'
        `)
      ).rejects.toThrow();
    });

    it('atomically decrements on-hand stock when sourcing a TRACKED product', async () => {
      // 1. Place order containing tracked product (quantity 3)
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          address_id: addressId,
          items: [{ product_id: trackedProductId, quantity: 3 }],
        });

      const newOrderId = orderRes.body.data.order.id;
      const itemsRes = await pool.query(
        `SELECT id FROM order_items WHERE order_id = $1`,
        [newOrderId]
      );
      const trackedItemId = itemsRes.rows[0].id;

      // 2. Source the item
      const sourceRes = await request(app)
        .post(`/api/v1/admin/orders/${newOrderId}/items/${trackedItemId}/source`)
        .set('Authorization', `Bearer ${tokenStaff}`)
        .send({
          actual_unit_cost: 395.0,
          notes: 'Fulfilled from dark store tracked stock',
        });

      expect(sourceRes.status).toBe(200);

      // 3. Verify stock decremented: 50 - 3 = 47
      const invRes = await pool.query(
        `SELECT quantity_on_hand FROM inventory WHERE product_id = $1 AND dark_store_id = $2`,
        [trackedProductId, storeId]
      );
      expect(invRes.rows[0].quantity_on_hand).toBe(47);

      // 4. Verify ORDER_FULFILLMENT adjustment ledger entry
      const adjRes = await pool.query(
        `SELECT * FROM inventory_adjustments WHERE reference_order_id = $1`,
        [newOrderId]
      );
      expect(adjRes.rows.length).toBe(1);
      expect(adjRes.rows[0].adjustment_type).toBe('ORDER_FULFILLMENT');
      expect(adjRes.rows[0].quantity_delta).toBe(-3);
    });

    it('lists inventory with low-stock filter support via GET /admin/inventory', async () => {
      const res = await request(app)
        .get('/api/v1/admin/inventory?low_stock_only=false')
        .set('Authorization', `Bearer ${tokenStaff}`);

      expect(res.status).toBe(200);
      expect(res.body.data.inventory.length).toBeGreaterThan(0);
      expect(res.body.data.pagination).toBeDefined();
    });
  });

  // ==========================================================================
  // 7. SUPPLIER MANAGEMENT
  // ==========================================================================
  describe('Supplier Management API', () => {
    let createdSupplierId: string;
    const testCode = `SUP-KANDY-${Date.now()}`;

    // Remove the supplier this block creates. Earlier runs did not, which is
    // how inactive "Kandy Dairy Cooperative" rows accumulated in the dev DB.
    afterAll(async () => {
      if (createdSupplierId) {
        await pool.query('DELETE FROM suppliers WHERE id = $1', [createdSupplierId]);
      }
    });

    it('allows ADMIN to create a supplier', async () => {
      const res = await request(app)
        .post('/api/v1/admin/suppliers')
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          name: 'Kandy Dairy Cooperative',
          code: testCode,
          contact_person: 'Sunil Bandara',
          contact_phone: '+94812233445',
          address: 'Peradeniya Road, Kandy',
          notes: 'Organic milk supplier',
        });

      expect(res.status).toBe(201);
      expect(res.body.data.supplier.name).toBe('Kandy Dairy Cooperative');
      expect(res.body.data.supplier.code).toBe(testCode);
      createdSupplierId = res.body.data.supplier.id;
    });

    it('allows STAFF to list suppliers', async () => {
      const res = await request(app)
        .get('/api/v1/admin/suppliers')
        .set('Authorization', `Bearer ${tokenStaff}`);

      expect(res.status).toBe(200);
      expect(res.body.data.suppliers.length).toBeGreaterThan(0);
    });

    it('allows retrieving supplier by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/admin/suppliers/${createdSupplierId}`)
        .set('Authorization', `Bearer ${tokenStaff}`);

      expect(res.status).toBe(200);
      expect(res.body.data.supplier.id).toBe(createdSupplierId);
    });

    it('allows ADMIN to update supplier details', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/suppliers/${createdSupplierId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({
          notes: 'Updated wholesale delivery schedule',
          is_active: false,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.supplier.is_active).toBe(false);
      expect(res.body.data.supplier.notes).toBe('Updated wholesale delivery schedule');
    });
  });

  // ==========================================================================
  // 8. CONCURRENCY & RACE CONDITION SAFETY
  // ==========================================================================
  describe('Concurrency & Race Condition Safety', () => {
    it('safely handles concurrent sourcing requests without duplicate records or cost corruption', async () => {
      // Create a fresh order for concurrency test
      const orderRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomer}`)
        .send({
          address_id: addressId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });

      const concOrderId = orderRes.body.data.order.id;
      const itemRes = await pool.query(
        `SELECT id FROM order_items WHERE order_id = $1`,
        [concOrderId]
      );
      const concItemId = itemRes.rows[0].id;

      // Two operators simultaneously submit sourcing with different actual costs
      const [call1, call2] = await Promise.all([
        request(app)
          .post(`/api/v1/admin/orders/${concOrderId}/items/${concItemId}/source`)
          .set('Authorization', `Bearer ${tokenStaff}`)
          .send({ actual_unit_cost: 452.0 }),
        request(app)
          .post(`/api/v1/admin/orders/${concOrderId}/items/${concItemId}/source`)
          .set('Authorization', `Bearer ${tokenAdmin}`)
          .send({ actual_unit_cost: 454.0 }),
      ]);

      // The row lock serialises them; the second sees the item already
      // SOURCED and is refused, so exactly one cost is ever recorded.
      expect([call1.status, call2.status].sort()).toEqual([200, 409]);
      const refused = call1.status === 409 ? call1 : call2;
      expect(refused.body.error.code).toBe('ITEM_ALREADY_SOURCED');

      const recordsRes = await pool.query(
        `SELECT actual_unit_cost FROM sourcing_records WHERE order_item_id = $1`,
        [concItemId]
      );
      expect(recordsRes.rows).toHaveLength(1);

      // Verify item state is consistent with the one accepted submission
      const checkRes = await pool.query(
        `SELECT actual_unit_cost, estimated_unit_cost, unit_selling_price FROM order_items WHERE id = $1`,
        [concItemId]
      );
      const finalCost = Number(checkRes.rows[0].actual_unit_cost);
      expect(finalCost).toBe(Number(recordsRes.rows[0].actual_unit_cost));
      expect([452.0, 454.0]).toContain(finalCost);
      expect(Number(checkRes.rows[0].estimated_unit_cost)).toBe(450.0);
      expect(Number(checkRes.rows[0].unit_selling_price)).toBe(540.0);
    });
  });
});
