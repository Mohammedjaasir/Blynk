import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { auth, stockFixtures, tokens } from './helpers/stock.js';

/**
 * Sourcing and supplier endpoints (inventory plan Task 6): malformed ids are a
 * 400, an inactive supplier is refused however it is named, and only an admin
 * can create a supplier - also implicitly, by naming one during sourcing (I4).
 * A refused request writes nothing: no cost, no sourcing record, no stock.
 */
describe('Sourcing and supplier hardening', () => {
  const app = createApp();
  const fx = stockFixtures(app, 'INTEG-SRC-');
  const RUN = `Hardening ${Date.now()}`;

  beforeAll(fx.setup);
  afterAll(async () => {
    await fx.cleanup();
    await pool.query('DELETE FROM suppliers WHERE name LIKE $1', [`${RUN}%`]);
  });

  async function supplier(name: string, active: boolean) {
    const res = await request(app).post('/api/v1/admin/suppliers').set(auth(tokens.admin)).send({ name });
    expect(res.status).toBe(201);
    const id = res.body.data.supplier.id as string;
    if (!active) {
      expect((await request(app).patch(`/api/v1/admin/suppliers/${id}`).set(auth(tokens.admin)).send({ is_active: false })).status).toBe(200);
    }
    return id;
  }

  /** A fresh tracked order line nobody has sourced yet. */
  async function pendingLine() {
    const t = await fx.product({ onHand: 5 });
    const order = await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);
    return { t, order, itemId: order.itemIds[0] };
  }

  async function expectUntouched(line: Awaited<ReturnType<typeof pendingLine>>) {
    const item = (await pool.query('SELECT item_status, actual_unit_cost FROM order_items WHERE id = $1', [line.itemId])).rows[0];
    expect(item).toEqual({ item_status: 'PENDING', actual_unit_cost: null });
    expect((await pool.query('SELECT count(*)::int n FROM sourcing_records WHERE order_item_id = $1', [line.itemId])).rows[0].n).toBe(0);
    expect(await fx.onHand(line.t)).toBe(5);
  }

  describe('malformed ids are a 400, not a server error', () => {
    it.each([
      ['POST', '/api/v1/admin/orders/not-a-uuid/items/00000000-0000-0000-0000-000000000000/source'],
      ['POST', '/api/v1/admin/orders/00000000-0000-0000-0000-000000000000/items/not-a-uuid/source'],
      ['GET', '/api/v1/admin/orders/not-a-uuid/sourcing'],
      ['GET', '/api/v1/admin/suppliers/not-a-uuid'],
      ['PATCH', '/api/v1/admin/suppliers/not-a-uuid'],
    ])('%s %s', async (method, url) => {
      const req = method === 'GET' ? request(app).get(url) : method === 'PATCH' ? request(app).patch(url) : request(app).post(url);
      const res = await req.set(auth(tokens.admin)).send({ actual_unit_cost: 10, notes: 'x' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('supplier named during sourcing (I4)', () => {
    it('refuses an inactive supplier by name, and writes nothing', async () => {
      const name = `${RUN} Closed Stall`;
      await supplier(name, false);
      const line = await pendingLine();

      const res = await fx.source(line.order.id, line.itemId, { supplier_name: name });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SUPPLIER_INACTIVE');
      await expectUntouched(line);
    });

    it('refuses packing staff creating a new supplier by name, and writes nothing', async () => {
      const name = `${RUN} New Stall`;
      const line = await pendingLine();

      const res = await fx.source(line.order.id, line.itemId, { supplier_name: name }, tokens.staff);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect((await pool.query('SELECT count(*)::int n FROM suppliers WHERE name = $1', [name])).rows[0].n).toBe(0);
      await expectUntouched(line);
    });

    it('lets an admin create a supplier by name while sourcing (existing behaviour)', async () => {
      const name = `${RUN} Admin Stall`;
      const line = await pendingLine();

      const res = await fx.source(line.order.id, line.itemId, { supplier_name: name }, tokens.admin);

      expect(res.status).toBe(200);
      const rows = (await pool.query('SELECT id, is_active FROM suppliers WHERE name = $1', [name])).rows;
      expect(rows).toEqual([{ id: res.body.data.sourcing_record.supplier_id, is_active: true }]);
    });

    it('lets packing staff name an existing active supplier', async () => {
      const name = `${RUN} Known Stall`;
      const id = await supplier(name, true);
      const line = await pendingLine();

      const res = await fx.source(line.order.id, line.itemId, { supplier_name: name }, tokens.staff);

      expect(res.status).toBe(200);
      expect(res.body.data.sourcing_record.supplier_id).toBe(id);
    });

    it('uses the active supplier when an inactive one shares its name', async () => {
      const name = `${RUN} Shared Name`;
      await supplier(name, false);
      const active = await supplier(name, true);
      const line = await pendingLine();

      const res = await fx.source(line.order.id, line.itemId, { supplier_name: name }, tokens.staff);

      expect(res.status).toBe(200);
      expect(res.body.data.sourcing_record.supplier_id).toBe(active);
    });

    it('still refuses an inactive supplier by id (existing contract)', async () => {
      const id = await supplier(`${RUN} Closed By Id`, false);
      const line = await pendingLine();

      const res = await fx.source(line.order.id, line.itemId, { supplier_id: id });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('SUPPLIER_INACTIVE');
      await expectUntouched(line);
    });
  });
});
