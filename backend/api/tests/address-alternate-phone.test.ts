import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { generateAccessToken } from '../src/modules/auth/token.service.js';
import { liftRiderTripCap } from './helpers/rider-trips.js';
import { customerFixtures } from './helpers/customers.js';

liftRiderTripCap();

/**
 * Migration 024: an optional additional phone number on a delivery address,
 * snapshotted onto the order (delivery_alternate_phone) and shown wherever
 * the recipient phone is - the customer's order, the staff order detail and
 * the rider's delivery payloads.
 *
 * Two fresh fixture customers own every address and order here; cleanup()
 * removes them with their orders, deliveries and notifications. Only the
 * seeded UNTRACKED milk is ordered, so no stock is touched.
 */
const app = createApp();
const people = customerFixtures(app, { idPrefix: 'c0c00007', phoneBase: '+9470997', name: 'Alt Phone Customer' });

describe('Address additional phone (migration 024)', () => {
  const admin = { id: 'a0000001-0000-0000-0000-000000000003', phone: '+94775551122', role: 'ADMIN' as const };
  const staff = { id: 'a0000001-0000-0000-0000-000000000004', phone: '+94774443322', role: 'PACKING_STAFF' as const };
  const riderUser = { id: 'a0000001-0000-0000-0000-000000000002', phone: '+94779876543', role: 'RIDER' as const };
  const RIDER = 'f0000001-0000-0000-0000-000000000001';
  const MILK = 'b0000001-0000-0000-0000-000000000001';
  const tokens = {
    customer: '',
    other: '',
    admin: generateAccessToken(admin),
    staff: generateAccessToken(staff),
    rider: generateAccessToken(riderUser),
  };

  const base = {
    label: 'Alt phone test',
    recipient_name: 'Alt Phone Test',
    recipient_phone: '077 123 4567',
    address_line1: 'No. 24, Test Lane',
    city: 'Dharga Town',
    latitude: 6.4351,
    longitude: 80.0243,
  };
  const createAddress = (body: object) =>
    request(app).post('/api/v1/me/addresses').set('Authorization', `Bearer ${tokens.customer}`).send({ ...base, ...body });
  const patchAddress = (id: string, body: object) =>
    request(app).patch(`/api/v1/me/addresses/${id}`).set('Authorization', `Bearer ${tokens.customer}`).send(body);

  beforeAll(async () => {
    await people.purge(2);
    tokens.customer = (await people.customer(1)).token;
    tokens.other = (await people.customer(2)).token;
  });

  afterAll(async () => {
    await people.cleanup();
  });

  describe('address book', () => {
    it('stores a normalised additional phone and returns it', async () => {
      const res = await createAddress({ alternate_phone: '071 234 5678' });
      expect(res.status).toBe(201);
      expect(res.body.data.address.alternate_phone).toBe('+94712345678');

      const list = await request(app).get('/api/v1/me/addresses').set('Authorization', `Bearer ${tokens.customer}`);
      const row = list.body.data.addresses.find((a: { id: string }) => a.id === res.body.data.address.id);
      expect(row.alternate_phone).toBe('+94712345678');
    });

    it('is optional: omitted, null and empty all store null', async () => {
      for (const body of [{}, { alternate_phone: null }, { alternate_phone: '  ' }]) {
        const res = await createAddress(body);
        expect(res.status).toBe(201);
        expect(res.body.data.address.alternate_phone).toBeNull();
      }
    });

    it('rejects an invalid number with 400 VALIDATION_ERROR', async () => {
      const res = await createAddress({ alternate_phone: '12345' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an invalid recipient phone with 400 VALIDATION_ERROR, not 500', async () => {
      const created = await createAddress({ recipient_phone: '12345' });
      expect(created.status).toBe(400);
      expect(created.body.error.code).toBe('VALIDATION_ERROR');

      const ok = await createAddress({});
      expect(ok.status).toBe(201);
      const patched = await patchAddress(ok.body.data.address.id, { recipient_phone: 'not a phone' });
      expect(patched.status).toBe(400);
      expect(patched.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects the recipient phone again (in any format) with 400', async () => {
      const res = await createAddress({ alternate_phone: '+94 77 123 4567' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ALTERNATE_PHONE_SAME_AS_RECIPIENT');
      expect(res.body.error.message).toMatch(/different from the recipient/);
    });

    it('updates, checks against the stored recipient, and clears', async () => {
      const created = await createAddress({});
      const id = created.body.data.address.id;

      const set = await patchAddress(id, { alternate_phone: '0751112233' });
      expect(set.status).toBe(200);
      expect(set.body.data.address.alternate_phone).toBe('+94751112233');

      // Only the alternate is sent; it is compared with the stored recipient phone.
      const same = await patchAddress(id, { alternate_phone: '0771234567' });
      expect(same.status).toBe(400);
      expect(same.body.error.code).toBe('ALTERNATE_PHONE_SAME_AS_RECIPIENT');

      // Changing the recipient to the stored alternate is the same duplicate.
      const swapped = await patchAddress(id, { recipient_phone: '0751112233' });
      expect(swapped.status).toBe(400);
      expect(swapped.body.error.code).toBe('ALTERNATE_PHONE_SAME_AS_RECIPIENT');

      // Leaving it out keeps it.
      const untouched = await patchAddress(id, { label: 'Renamed' });
      expect(untouched.body.data.address.alternate_phone).toBe('+94751112233');

      const cleared = await patchAddress(id, { alternate_phone: null });
      expect(cleared.status).toBe(200);
      expect(cleared.body.data.address.alternate_phone).toBeNull();
    });

    it('another customer cannot probe an address through the duplicate check', async () => {
      const created = await createAddress({});
      const res = await request(app)
        .patch(`/api/v1/me/addresses/${created.body.data.address.id}`)
        .set('Authorization', `Bearer ${tokens.other}`)
        .send({ alternate_phone: '0751112233' });
      expect(res.status).toBe(404);
    });
  });

  describe('order snapshot and payloads', () => {
    let orderId = '';
    let addressId = '';

    beforeAll(async () => {
      const addr = await createAddress({ alternate_phone: '0712345678' });
      addressId = addr.body.data.address.id;
      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${tokens.customer}`)
        .send({ address_id: addressId, items: [{ product_id: MILK, quantity: 1 }] });
      expect(res.status).toBe(201);
      orderId = res.body.data.order.id;
    });

    it('snapshots the address number onto the order at creation', async () => {
      const db = await pool.query('SELECT delivery_alternate_phone FROM orders WHERE id = $1', [orderId]);
      expect(db.rows[0].delivery_alternate_phone).toBe('+94712345678');

      // Editing the address afterwards does not change the placed order.
      await patchAddress(addressId, { alternate_phone: null });
      const after = await pool.query('SELECT delivery_alternate_phone FROM orders WHERE id = $1', [orderId]);
      expect(after.rows[0].delivery_alternate_phone).toBe('+94712345678');
    });

    it('the customer sees it on their own order', async () => {
      const res = await request(app).get(`/api/v1/orders/${orderId}`).set('Authorization', `Bearer ${tokens.customer}`);
      expect(res.status).toBe(200);
      const order = res.body.data.order ?? res.body.data;
      expect(order.delivery_alternate_phone).toBe('+94712345678');
    });

    it('staff see it on the order detail and the packing list', async () => {
      const detail = await request(app).get(`/api/v1/admin/orders/${orderId}`).set('Authorization', `Bearer ${tokens.staff}`);
      expect(detail.status).toBe(200);
      const order = detail.body.data.order ?? detail.body.data;
      expect(order.delivery_alternate_phone).toBe('+94712345678');

      const list = await request(app).get('/api/v1/admin/orders?status=PLACED&limit=100').set('Authorization', `Bearer ${tokens.staff}`);
      expect(list.status).toBe(200);
      const row = (list.body.data.orders as Array<{ id: string; delivery_alternate_phone: string | null }>).find((o) => o.id === orderId);
      expect(row?.delivery_alternate_phone).toBe('+94712345678');
    });

    it('the assigned rider gets it in the delivery list and detail', async () => {
      const pending = await pool.query(`SELECT id FROM order_items WHERE order_id = $1 AND item_status = 'PENDING'`, [orderId]);
      for (const { id } of pending.rows) {
        await request(app)
          .post(`/api/v1/admin/orders/${orderId}/items/${id}/source`)
          .set('Authorization', `Bearer ${tokens.staff}`)
          .send({ actual_unit_cost: 450 });
      }
      const packed = await request(app)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${tokens.staff}`)
        .send({ status: 'PACKED' });
      expect(packed.status).toBe(200);
      const assigned = await request(app)
        .post(`/api/v1/admin/orders/${orderId}/assign-rider`)
        .set('Authorization', `Bearer ${tokens.admin}`)
        .send({ rider_id: RIDER });
      expect(assigned.status).toBe(200);
      const deliveryId = assigned.body.data.delivery.id;

      const list = await request(app).get('/api/v1/riders/deliveries').set('Authorization', `Bearer ${tokens.rider}`);
      const row = list.body.data.deliveries.find((d: { delivery_id: string }) => d.delivery_id === deliveryId);
      expect(row.delivery_alternate_phone).toBe('+94712345678');

      const detail = await request(app).get(`/api/v1/riders/deliveries/${deliveryId}`).set('Authorization', `Bearer ${tokens.rider}`);
      expect(detail.status).toBe(200);
      expect(detail.body.data.delivery.delivery_alternate_phone).toBe('+94712345678');
    });
  });
});
