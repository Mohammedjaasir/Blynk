import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';

describe('Stage 4 Orders, Checkout & COD Settlement Module', () => {
  const app = createApp();

  // Test Users
  const customerA = {
    id: 'a0000001-0000-0000-0000-000000000001',
    phone: '+94771234567',
    role: 'CUSTOMER' as const,
  };
  const tokenCustomerA = generateAccessToken(customerA);

  const customerB = {
    id: 'a0000001-0000-0000-0000-000000000010',
    phone: '+94772223344',
    role: 'CUSTOMER' as const,
  };
  const tokenCustomerB = generateAccessToken(customerB);

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

  let addressWithin4kmId: string;
  let addressBeyond4kmId: string;
  let riderId: string;

  /**
   * Sources every item still PENDING through the real sourcing endpoint:
   * packing requires items sourced and bagged (architecture §G; dispatch D7).
   */
  async function sourceAllPending(orderId: string) {
    const pending = await pool.query(`SELECT id FROM order_items WHERE order_id = $1 AND item_status = 'PENDING'`, [orderId]);
    for (const { id } of pending.rows) {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${orderId}/items/${id}/source`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ actual_unit_cost: 400 });
      expect(res.status).toBe(200);
    }
  }

  beforeAll(async () => {
    // Ensure customer B exists
    await pool.query(`
      INSERT INTO users (id, phone, full_name, role)
      VALUES ('${customerB.id}', '${customerB.phone}', 'Customer B Test', 'CUSTOMER')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Ensure test rider exists in riders table linked to riderUser.id
    const riderRes = await pool.query(`
      INSERT INTO riders (user_id, dark_store_id, vehicle_registration_number, is_available, is_active)
      VALUES (
        '${riderUser.id}',
        '018dc3f0-4a82-789a-8b1b-947f61ad8821',
        'WP-BC-1234',
        true,
        true
      )
      ON CONFLICT (user_id) DO UPDATE SET is_active = true, is_available = true
      RETURNING id;
    `);
    riderId = riderRes.rows[0].id;
  });

  afterAll(async () => {
    // Clean up test orders, addresses, and notifications
    await pool.query(`
      DELETE FROM notifications WHERE user_id IN ('${customerA.id}', '${customerB.id}');
      DELETE FROM deliveries WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN ('${customerA.id}', '${customerB.id}'));
      DELETE FROM payments WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN ('${customerA.id}', '${customerB.id}'));
      DELETE FROM order_status_history WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN ('${customerA.id}', '${customerB.id}'));
      DELETE FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE customer_id IN ('${customerA.id}', '${customerB.id}'));
      DELETE FROM orders WHERE customer_id IN ('${customerA.id}', '${customerB.id}');
      DELETE FROM customer_addresses WHERE user_id IN ('${customerA.id}', '${customerB.id}');
      DELETE FROM users WHERE id = '${customerB.id}';
    `);
  });

  // ==========================================================================
  // 1. CUSTOMER ADDRESS BOOK API (/api/v1/me/addresses)
  // ==========================================================================
  describe('Customer Address Book API', () => {
    it('allows customer to create delivery address within 4 km radius', async () => {
      // Dharga Town address ~0.15 km from Hub (6.438200, 80.027400)
      const res = await request(app)
        .post('/api/v1/me/addresses')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          label: 'Home',
          recipient_name: 'Ahmed Rizvi',
          recipient_phone: '077 123 4567',
          address_line1: '12, Old Mosque Road',
          city: 'Dharga Town',
          latitude: 6.4391,
          longitude: 80.028,
          delivery_instructions: 'Blue gate near the corner',
          is_default: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.address.id).toBeDefined();
      expect(res.body.data.address.recipient_phone).toBe('+94771234567'); // normalized
      expect(res.body.data.address.is_default).toBe(true);
      addressWithin4kmId = res.body.data.address.id;
    });

    it('allows customer to create address beyond 4 km radius (e.g. 18 km away in Kalutara)', async () => {
      // Kalutara location (~18 km from Dharga Town)
      const res = await request(app)
        .post('/api/v1/me/addresses')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          label: 'Office',
          recipient_name: 'Ahmed Rizvi Work',
          recipient_phone: '077 123 4567',
          address_line1: '500, Galle Road',
          city: 'Kalutara',
          latitude: 6.5854,
          longitude: 79.9607,
          is_default: false,
        });

      expect(res.status).toBe(201);
      addressBeyond4kmId = res.body.data.address.id;
    });

    it('lists customer active addresses with default address prioritized', async () => {
      const res = await request(app)
        .get('/api/v1/me/addresses')
        .set('Authorization', `Bearer ${tokenCustomerA}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.addresses)).toBe(true);
      expect(res.body.data.addresses.length).toBeGreaterThanOrEqual(2);
      expect(res.body.data.addresses[0].is_default).toBe(true);
    });

    it('retrieves single address by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/me/addresses/${addressWithin4kmId}`)
        .set('Authorization', `Bearer ${tokenCustomerA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.address.id).toBe(addressWithin4kmId);
    });

    it('updates customer address attributes', async () => {
      const res = await request(app)
        .patch(`/api/v1/me/addresses/${addressWithin4kmId}`)
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          delivery_instructions: 'Ring the doorbell twice',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.address.delivery_instructions).toBe('Ring the doorbell twice');
    });

    it('enforces IDOR protection: Customer B cannot view or modify Customer A address', async () => {
      const getRes = await request(app)
        .get(`/api/v1/me/addresses/${addressWithin4kmId}`)
        .set('Authorization', `Bearer ${tokenCustomerB}`);
      expect(getRes.status).toBe(404);

      const patchRes = await request(app)
        .patch(`/api/v1/me/addresses/${addressWithin4kmId}`)
        .set('Authorization', `Bearer ${tokenCustomerB}`)
        .send({ label: 'Hacked' });
      expect(patchRes.status).toBe(404);
    });
  });

  // ==========================================================================
  // 2. CHECKOUT & ORDERS ENGINE (POST /api/v1/orders)
  // ==========================================================================
  describe('Checkout & Orders Engine', () => {
    let placedOrderId: string;
    let placedOrderNumber: string;

    it('rejects checkout when delivery address is outside 4.00 km service zone with HTTP 422', async () => {
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          address_id: addressBeyond4kmId, // Kalutara (18 km)
          items: [
            {
              product_id: 'b0000001-0000-0000-0000-000000000001', // Kotmale Milk
              quantity: 2,
            },
          ],
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('DELIVERY_OUTSIDE_RADIUS');
      expect(res.body.error.details.distance_km).toBeGreaterThan(4.0);
    });

    it('successfully places an order within 4 km with authoritative pricing and 70 LKR fee', async () => {
      const idempotencyKey = `idemp_test_${Date.now()}`;

      // Kotmale Fresh Milk: 450 cost * 1.20 = 540 LKR * 2 = 1080 LKR
      // Pelwatte Salted Butter: 700 cost * 1.15 = 805 LKR * 1 = 805 LKR
      // Subtotal = 1885.00 LKR
      // Delivery fee = 70.00 LKR
      // Total = 1955.00 LKR
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          address_id: addressWithin4kmId,
          items: [
            {
              product_id: 'b0000001-0000-0000-0000-000000000001', // Milk (540 LKR)
              quantity: 2,
            },
            {
              product_id: 'b0000001-0000-0000-0000-000000000002', // Butter (805 LKR)
              quantity: 1,
            },
          ],
          customer_notes: 'Please do not crush butter',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);

      const order = res.body.data.order;
      expect(order.id).toBeDefined();
      expect(order.order_number).toMatch(/^BL-/);
      expect(order.order_status).toBe('PLACED');
      expect(order.payment_method).toBe('COD');
      expect(order.payment_status).toBe('PENDING');

      // Amounts
      expect(order.subtotal_amount).toBe(1885.0);
      expect(order.delivery_fee).toBe(70.0);
      expect(order.total_amount).toBe(1955.0);

      // Historical address snapshot verification
      expect(order.delivery_recipient_name).toBe('Ahmed Rizvi');
      expect(order.delivery_recipient_phone).toBe('+94771234567');
      expect(order.delivery_address_line1).toBe('12, Old Mosque Road');
      expect(order.delivery_city).toBe('Dharga Town');

      // Line items snapshot
      expect(order.items.length).toBe(2);
      const milkItem = order.items.find((i: any) => i.sku_snapshot === 'SKU-DAI-001');
      expect(milkItem.quantity).toBe(2);
      expect(milkItem.unit_selling_price).toBe(540.0);
      expect(milkItem.subtotal).toBe(1080.0);
      expect(milkItem.item_status).toBe('PENDING');

      // COD payment record
      expect(order.payment.amount).toBe(1955.0);
      expect(order.payment.payment_status).toBe('PENDING');

      placedOrderId = order.id;
      placedOrderNumber = order.order_number;

      // Verify outbox notification insertion in PostgreSQL
      const notifRes = await pool.query(
        `SELECT * FROM notifications WHERE order_id = $1`,
        [placedOrderId]
      );
      expect(notifRes.rows.length).toBe(1);
      expect(notifRes.rows[0].channel).toBe('SMS');
      expect(notifRes.rows[0].status).toBe('QUEUED');
    });

    it('enforces idempotency: repeated request with same Idempotency-Key returns cached order without duplicate DB rows', async () => {
      const idempotencyKey = `idemp_repeat_${Date.now()}`;

      // First submission
      const res1 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          address_id: addressWithin4kmId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });
      expect(res1.status).toBe(201);
      const originalOrderId = res1.body.data.order.id;

      // Second identical submission
      const res2 = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .set('Idempotency-Key', idempotencyKey)
        .send({
          address_id: addressWithin4kmId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });
      expect(res2.status).toBe(200);
      expect(res2.body.data.is_idempotent_replay).toBe(true);
      expect(res2.body.data.order.id).toBe(originalOrderId);

      // Verify no duplicate order inserted
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM orders WHERE idempotency_key = $1`,
        [idempotencyKey]
      );
      expect(countRes.rows[0].count).toBe('1');
    });

    it('lists customer orders and retrieves single order details', async () => {
      // List
      const listRes = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.orders.length).toBeGreaterThanOrEqual(1);

      // Detail
      const detailRes = await request(app)
        .get(`/api/v1/orders/${placedOrderId}`)
        .set('Authorization', `Bearer ${tokenCustomerA}`);
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.order.id).toBe(placedOrderId);
      expect(detailRes.body.data.order.items.length).toBe(2);
      expect(detailRes.body.data.order.history.length).toBeGreaterThanOrEqual(1);
    });

    it('enforces customer isolation: Customer B cannot view Customer A order', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${placedOrderId}`)
        .set('Authorization', `Bearer ${tokenCustomerB}`);
      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // 3. CANCELLATION GATES & LIFECYCLE
  // ==========================================================================
  describe('Customer Cancellation Window & Gates', () => {
    it('allows customer cancellation while order is in PLACED state', async () => {
      // Create a fresh order to cancel
      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          address_id: addressWithin4kmId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });
      const orderId = createRes.body.data.order.id;

      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({ reason: 'Changed mind, ordering later' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.order.order_status).toBe('CANCELLED');
      expect(cancelRes.body.data.order.cancellation_reason).toBe('Changed mind, ordering later');
    });

    it('allows customer cancellation while order is in PACKED state', async () => {
      // 1. Create order
      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          address_id: addressWithin4kmId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });
      const orderId = createRes.body.data.order.id;

      // 2. Admin moves order to PACKED (items sourced first)
      await sourceAllPending(orderId);
      await request(app)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'PACKED' });

      // 3. Customer cancels PACKED order -> Allowed
      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({ reason: 'Emergency, have to leave house' });

      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.data.order.order_status).toBe('CANCELLED');
    });

    it('blocks customer cancellation once order is OUT_FOR_DELIVERY with 400 ORDER_ALREADY_OUT_FOR_DELIVERY', async () => {
      // 1. Create order
      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          address_id: addressWithin4kmId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });
      const orderId = createRes.body.data.order.id;

      // 2. Transition order directly to OUT_FOR_DELIVERY
      await pool.query(
        `UPDATE orders SET order_status = 'OUT_FOR_DELIVERY' WHERE id = $1`,
        [orderId]
      );

      // 3. Customer attempts cancellation -> Blocked
      const cancelRes = await request(app)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({ reason: 'Too late' });

      expect(cancelRes.status).toBe(400);
      expect(cancelRes.body.error.code).toBe('ORDER_ALREADY_OUT_FOR_DELIVERY');
    });
  });

  // ==========================================================================
  // 4. STORE OPERATIONS & OUT-OF-STOCK RESOLUTION
  // ==========================================================================
  describe('Store Operations, Packing Queue & Out-of-Stock Resolution', () => {
    let storeOrderId: string;
    let milkItemId: string;
    let butterItemId: string;

    beforeAll(async () => {
      // Create multi-item order for store testing:
      // Milk (2x @ 540 = 1080 LKR), Butter (1x @ 805 = 805 LKR), Fee (70) -> Total 1955 LKR
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          address_id: addressWithin4kmId,
          items: [
            { product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 2 },
            { product_id: 'b0000001-0000-0000-0000-000000000002', quantity: 1 },
          ],
        });
      storeOrderId = res.body.data.order.id;
      const milk = res.body.data.order.items.find((i: any) => i.sku_snapshot === 'SKU-DAI-001');
      const butter = res.body.data.order.items.find((i: any) => i.sku_snapshot === 'SKU-DAI-002');
      milkItemId = milk.id;
      butterItemId = butter.id;
    });

    it('allows admin / staff to view packing queue (orders awaiting sourcing & packing)', async () => {
      const res = await request(app)
        .get('/api/v1/admin/packing-queue')
        .set('Authorization', `Bearer ${tokenAdmin}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.queue)).toBe(true);
      const found = res.body.data.queue.find((o: any) => o.id === storeOrderId);
      expect(found).toBeDefined();
    });

    it('resolves unavailable item during sourcing and automatically recalculates subtotal, total, and COD payment', async () => {
      // Store staff discovers Pelwatte Butter is unavailable at local Dharga Town merchant
      // Removes butter (805 LKR):
      // New Subtotal = 1080 LKR
      // New Total = 1080 + 70 = 1150 LKR
      const res = await request(app)
        .patch(`/api/v1/admin/orders/${storeOrderId}/items/${butterItemId}`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ item_status: 'UNAVAILABLE' });

      expect(res.status).toBe(200);
      const order = res.body.data.order;
      expect(order.subtotal_amount).toBe(1080.0);
      expect(order.total_amount).toBe(1150.0);
      expect(order.payment.amount).toBe(1150.0);
      expect(order.order_status).toBe('ITEM_UNAVAILABLE');
    });

    it('allows store staff to transition order to PACKED', async () => {
      await sourceAllPending(storeOrderId);
      const res = await request(app)
        .patch(`/api/v1/admin/orders/${storeOrderId}/status`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'PACKED' });

      expect(res.status).toBe(200);
      expect(res.body.data.order.order_status).toBe('PACKED');
    });

    it('manually assigns a rider to the order', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/orders/${storeOrderId}/assign-rider`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ rider_id: riderId });

      expect(res.status).toBe(200);
      expect(res.body.data.delivery.assignment_status).toBe('ASSIGNED');
    });

    it('prevents assigning a second active rider to an order that already has an active assignment (uq_deliveries_active_assignment)', async () => {
      // Second assignment attempt while first is active
      const res = await request(app)
        .post(`/api/v1/admin/orders/${storeOrderId}/assign-rider`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ rider_id: riderId });

      // One active assignment per order: reported as a conflict, not a server error
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ORDER_ALREADY_ASSIGNED');
    });
  });

  // ==========================================================================
  // 5. RIDER OPERATIONS & DOORSTEP COD CASH COLLECTION
  // ==========================================================================
  describe('Rider Fulfillment & Doorstep COD Cash Collection', () => {
    let deliveryId: string;
    let deliveryOrderId: string;
    const expectedCash = 610.0; // 540 + 70

    beforeAll(async () => {
      // Create fresh order: 1x Milk (540 LKR) + 70 fee = 610 LKR
      const createRes = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokenCustomerA}`)
        .send({
          address_id: addressWithin4kmId,
          items: [{ product_id: 'b0000001-0000-0000-0000-000000000001', quantity: 1 }],
        });
      deliveryOrderId = createRes.body.data.order.id;

      // Only a packed order can be assigned and picked up (architecture §G, §H).
      await sourceAllPending(deliveryOrderId);
      const packRes = await request(app)
        .patch(`/api/v1/admin/orders/${deliveryOrderId}/status`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ status: 'PACKED' });
      expect(packRes.status).toBe(200);

      // Admin assigns to test rider
      const assignRes = await request(app)
        .post(`/api/v1/admin/orders/${deliveryOrderId}/assign-rider`)
        .set('Authorization', `Bearer ${tokenAdmin}`)
        .send({ rider_id: riderId });
      deliveryId = assignRes.body.data.delivery.id;
    });

    it('rider lists assigned active deliveries', async () => {
      const res = await request(app)
        .get('/api/v1/riders/deliveries')
        .set('Authorization', `Bearer ${tokenRider}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.deliveries)).toBe(true);
      const delivery = res.body.data.deliveries.find((d: any) => d.delivery_id === deliveryId);
      expect(delivery).toBeDefined();
      expect(delivery.total_amount).toBe(expectedCash);
      expect(delivery.delivery_city).toBe('Dharga Town');
    });

    it('rider views single delivery details with customer location & instructions', async () => {
      const res = await request(app)
        .get(`/api/v1/riders/deliveries/${deliveryId}`)
        .set('Authorization', `Bearer ${tokenRider}`);

      expect(res.status).toBe(200);
      expect(res.body.data.delivery.delivery_id).toBe(deliveryId);
      expect(res.body.data.delivery.delivery_recipient_phone).toBe('+94771234567');
    });

    it('rider transitions delivery to PICKED_UP and automatically moves order to OUT_FOR_DELIVERY', async () => {
      const res = await request(app)
        .patch(`/api/v1/riders/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${tokenRider}`)
        .send({ status: 'PICKED_UP' });

      expect(res.status).toBe(200);
      expect(res.body.data.delivery.assignment_status).toBe('PICKED_UP');
      expect(res.body.data.delivery.order_status).toBe('OUT_FOR_DELIVERY');

      // Verify order table in database
      const dbOrder = await pool.query(`SELECT * FROM orders WHERE id = $1`, [deliveryOrderId]);
      expect(dbOrder.rows[0].order_status).toBe('OUT_FOR_DELIVERY');
      expect(dbOrder.rows[0].dispatched_at).not.toBeNull();
    });

    it('rider transitions delivery to ARRIVED_AT_CUSTOMER', async () => {
      const res = await request(app)
        .patch(`/api/v1/riders/deliveries/${deliveryId}/status`)
        .set('Authorization', `Bearer ${tokenRider}`)
        .send({ status: 'ARRIVED_AT_CUSTOMER' });

      expect(res.status).toBe(200);
      expect(res.body.data.delivery.assignment_status).toBe('ARRIVED_AT_CUSTOMER');
    });

    it('rejects COD collection if cash amount does not match total order amount', async () => {
      const res = await request(app)
        .post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`)
        .set('Authorization', `Bearer ${tokenRider}`)
        .send({ amount: 500.0 }); // Wrong amount (expected 610)

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_COD_AMOUNT');
    });

    it('completes doorstep COD cash collection: transitions Delivery -> DELIVERED, Payment -> PAID, Order -> DELIVERED', async () => {
      const res = await request(app)
        .post(`/api/v1/riders/deliveries/${deliveryId}/collect-cod`)
        .set('Authorization', `Bearer ${tokenRider}`)
        .send({ amount: expectedCash });

      expect(res.status).toBe(200);
      const settlement = res.body.data.settlement;
      expect(settlement.order_status).toBe('DELIVERED');
      expect(settlement.payment_status).toBe('PAID');
      expect(settlement.cod_collected_amount).toBe(expectedCash);

      // Verify PostgreSQL database state
      const dbOrder = await pool.query(`SELECT * FROM orders WHERE id = $1`, [deliveryOrderId]);
      expect(dbOrder.rows[0].order_status).toBe('DELIVERED');
      expect(dbOrder.rows[0].payment_status).toBe('PAID');
      expect(dbOrder.rows[0].delivered_at).not.toBeNull();

      const dbPayment = await pool.query(`SELECT * FROM payments WHERE order_id = $1`, [deliveryOrderId]);
      expect(dbPayment.rows[0].payment_status).toBe('PAID');
      expect(dbPayment.rows[0].paid_at).not.toBeNull();

      const dbDelivery = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [deliveryId]);
      expect(dbDelivery.rows[0].assignment_status).toBe('DELIVERED');
      expect(Number(dbDelivery.rows[0].cod_collected_amount)).toBe(expectedCash);
    });

    it('blocks non-rider users (CUSTOMER) from accessing rider endpoints with 403 FORBIDDEN', async () => {
      const res = await request(app)
        .get('/api/v1/riders/deliveries')
        .set('Authorization', `Bearer ${tokenCustomerA}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });
});
