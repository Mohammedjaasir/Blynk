import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/database/connection.js';
import request from 'supertest';
import { auth, repeat, stockFixtures, tokens, users, type Tracked } from './helpers/stock.js';

/**
 * Tracked stock across the whole order lifecycle (inventory plan §4):
 * sourcing takes the units, cancellation returns exactly what the order took
 * (atomic, ledger-backed, order-specific, idempotent), and nothing else moves
 * stock. Every test ends with the ledger explaining the count.
 */
describe('Inventory integrity', () => {
  const app = createApp();
  const fx = stockFixtures(app, 'INTEG-STOCK-');

  beforeAll(fx.setup);
  afterAll(fx.cleanup);

  const moves = async (orderId: string) =>
    (await fx.ledgerForOrder(orderId)).map((r) => [r.adjustment_type, r.quantity_delta] as const);

  async function sourcedOrder(t: Tracked, quantity: number) {
    const order = await fx.placeOrder([{ product_id: t.productId, quantity }]);
    await fx.sourceAll(order);
    return order;
  }

  describe('cancellation returns the stock the order took', () => {
    it('customer cancel after sourcing returns the sourced units, once, attributed to the customer', async () => {
      const t = await fx.product({ onHand: 10 });
      const order = await sourcedOrder(t, 3);
      expect(await fx.onHand(t)).toBe(7);

      const res = await fx.customerCancel(order.id);

      expect(res.status).toBe(200);
      expect(await fx.onHand(t)).toBe(10);
      const rows = await fx.ledgerForOrder(order.id);
      expect(rows.map((r) => [r.adjustment_type, r.quantity_delta])).toEqual([
        ['ORDER_FULFILLMENT', -3],
        ['ORDER_CANCELLATION_RESTORE', 3],
      ]);
      expect(rows[1]).toMatchObject({
        inventory_id: t.inventoryId,
        previous_quantity: 7,
        new_quantity: 10,
        reference_order_id: order.id,
        created_by_user_id: users.customer.id,
        notes: `Order ${order.order_number} cancelled by the customer: 3 returned to stock`,
      });
      await fx.expectLedgerChain(t);
    });

    it('admin cancel of a PLACED order returns the sourced units, attributed to the admin', async () => {
      const t = await fx.product({ onHand: 5 });
      const order = await sourcedOrder(t, 2);

      expect((await fx.adminCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(5);
      const rows = await fx.ledgerForOrder(order.id);
      expect(rows[1]).toMatchObject({
        adjustment_type: 'ORDER_CANCELLATION_RESTORE',
        quantity_delta: 2,
        created_by_user_id: users.admin.id,
        notes: `Order ${order.order_number} cancelled by the store: 2 returned to stock`,
      });
      await fx.expectLedgerChain(t);
    });

    it('admin cancel of an ITEM_UNAVAILABLE order returns only what was sourced', async () => {
      const a = await fx.product({ onHand: 6 });
      const b = await fx.product({ onHand: 6 });
      const order = await fx.placeOrder([
        { product_id: a.productId, quantity: 2 },
        { product_id: b.productId, quantity: 1 },
      ]);
      expect((await fx.source(order.id, order.itemFor(a.productId))).status).toBe(200);
      expect((await fx.resolve(order.id, order.itemFor(b.productId))).status).toBe(200);
      expect((await fx.orderRow(order.id)).order_status).toBe('ITEM_UNAVAILABLE');

      expect((await fx.adminCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(a)).toBe(6);
      expect(await fx.onHand(b)).toBe(6);
      expect(await moves(order.id)).toEqual([
        ['ORDER_FULFILLMENT', -2],
        ['ORDER_CANCELLATION_RESTORE', 2],
      ]);
      await fx.expectLedgerChain(a);
      await fx.expectLedgerChain(b);
    });

    it.each([
      ['customer', 'customerCancel'],
      ['admin', 'adminCancel'],
    ] as const)('%s cancel of a PACKED order returns the packed units', async (_who, how) => {
      const t = await fx.product({ onHand: 4 });
      const order = await sourcedOrder(t, 4);
      expect((await fx.pack(order.id)).status).toBe(200);
      expect(await fx.onHand(t)).toBe(0);

      expect((await fx[how](order.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(4);
      expect(await moves(order.id)).toEqual([
        ['ORDER_FULFILLMENT', -4],
        ['ORDER_CANCELLATION_RESTORE', 4],
      ]);
      await fx.expectLedgerChain(t);
    });

    it('cancel before sourcing moves nothing', async () => {
      const t = await fx.product({ onHand: 3 });
      const order = await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);

      expect((await fx.customerCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(3);
      expect(await moves(order.id)).toEqual([]);
    });

    it('an UNTRACKED product moves nothing, sourced or cancelled', async () => {
      const t = await fx.product({ tracked: false });
      const order = await sourcedOrder(t, 2);

      expect((await fx.customerCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(0);
      expect(await moves(order.id)).toEqual([]);
    });

    it('stock taken while TRACKED comes back even if tracking was switched off since (I5)', async () => {
      const t = await fx.product({ onHand: 8 });
      const order = await sourcedOrder(t, 3);
      await fx.setMode(t.productId, 'UNTRACKED');

      expect((await fx.adminCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(8);
      expect(await moves(order.id)).toEqual([
        ['ORDER_FULFILLMENT', -3],
        ['ORDER_CANCELLATION_RESTORE', 3],
      ]);
    });

    it('nothing comes back for an item sourced while UNTRACKED, even if tracked now (I5)', async () => {
      const t = await fx.product({ tracked: false });
      const order = await sourcedOrder(t, 2);
      await fx.setMode(t.productId, 'TRACKED');
      expect((await fx.adjust(t.productId, 'PURCHASE_RESTOCK', 5)).status).toBe(200);

      expect((await fx.customerCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(5);
      expect(await moves(order.id)).toEqual([]);
      await fx.expectLedgerChain(t);
    });

    it('two tracked lines return as two rows, one per product', async () => {
      const a = await fx.product({ onHand: 5 });
      const b = await fx.product({ onHand: 5 });
      const order = await fx.placeOrder([
        { product_id: a.productId, quantity: 1 },
        { product_id: b.productId, quantity: 2 },
      ]);
      await fx.sourceAll(order);

      expect((await fx.customerCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(a)).toBe(5);
      expect(await fx.onHand(b)).toBe(5);
      const restores = (await fx.ledgerForOrder(order.id)).filter((r) => r.adjustment_type === 'ORDER_CANCELLATION_RESTORE');
      expect(restores.map((r) => [r.inventory_id, r.quantity_delta]).sort()).toEqual(
        [
          [a.inventoryId, 1],
          [b.inventoryId, 2],
        ].sort()
      );
    });

    it('is order-specific: cancelling one order returns only its own units', async () => {
      const t = await fx.product({ onHand: 10 });
      const kept = await sourcedOrder(t, 3);
      const cancelled = await sourcedOrder(t, 2);
      expect(await fx.onHand(t)).toBe(5);

      expect((await fx.customerCancel(cancelled.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(7);
      expect(await moves(kept.id)).toEqual([['ORDER_FULFILLMENT', -3]]);
      await fx.expectLedgerChain(t);
    });

    it('is idempotent: a repeated cancellation never returns stock twice', async () => {
      const t = await fx.product({ onHand: 6 });
      const order = await sourcedOrder(t, 2);
      expect((await fx.customerCancel(order.id)).status).toBe(200);
      const after = await fx.ledgerForOrder(order.id);

      const again = await fx.customerCancel(order.id);
      expect(again.status).toBe(400);
      expect(again.body.error.code).toBe('ORDER_ALREADY_CANCELLED');
      const adminAgain = await fx.adminCancel(order.id);
      expect(adminAgain.status).toBe(422);
      expect(adminAgain.body.error.code).toBe('INVALID_STATUS_TRANSITION');

      const { restoreOrderStock } = await import('../src/modules/inventory/stock-ledger.js');
      const direct = await db.transaction().execute((trx) =>
        restoreOrderStock(trx, { id: order.id, order_number: order.order_number }, { id: users.admin.id, role: 'ADMIN' }, 'store')
      );
      expect(direct).toEqual([]);

      expect(await fx.onHand(t)).toBe(6);
      expect(await fx.ledgerForOrder(order.id)).toEqual(after);
      await fx.expectLedgerChain(t);
    });

    it('a refused cancellation leaves stock and ledger unchanged', async () => {
      const a = await fx.product({ onHand: 4 });
      const b = await fx.product({ onHand: 4 });
      const order = await fx.placeOrder([
        { product_id: a.productId, quantity: 1 },
        { product_id: b.productId, quantity: 1 },
      ]);
      expect((await fx.source(order.id, order.itemFor(a.productId))).status).toBe(200);
      expect((await fx.resolve(order.id, order.itemFor(b.productId))).status).toBe(200);
      const before = await fx.ledgerForOrder(order.id);

      // Customers may cancel only PLACED or PACKED orders (unchanged rule).
      const res = await fx.customerCancel(order.id);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('ORDER_CANNOT_BE_CANCELLED');

      expect(await fx.onHand(a)).toBe(3);
      expect(await fx.ledgerForOrder(order.id)).toEqual(before);
    });
  });

  describe('nothing but sourcing and cancellation moves stock (I1, I3)', () => {
    /** A PACKED order of `qty` units of a fresh tracked product with `onHand` in stock. */
    async function packed(onHand: number, qty: number) {
      const t = await fx.product({ onHand });
      const order = await sourcedOrder(t, qty);
      expect((await fx.pack(order.id)).status).toBe(200);
      return { t, order };
    }

    it('pack, assign, pickup and COD delivery take nothing beyond sourcing', async () => {
      const { t, order } = await packed(10, 3);
      expect(await fx.onHand(t)).toBe(7);

      await fx.deliver(order.id);

      expect((await fx.orderRow(order.id)).order_status).toBe('DELIVERED');
      expect(await fx.onHand(t)).toBe(7);
      expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -3]]);
      await fx.expectLedgerChain(t);
    });

    it('failed delivery, re-stage and a replacement rider consume the units exactly once', async () => {
      const { t, order } = await packed(6, 2);
      const a = await fx.assign(order.id);
      const first = a.body.data.delivery.id;
      expect((await fx.riderStep(first, { status: 'PICKED_UP' })).status).toBe(200);
      expect((await fx.riderStep(first, { status: 'FAILED', failure_reason: 'Vehicle breakdown' })).status).toBe(200);
      expect((await fx.orderRow(order.id)).order_status).toBe('FAILED');
      expect(await fx.onHand(t)).toBe(4);

      expect((await fx.setStatus(order.id, 'PACKED', undefined, 'Bag back on the shelf')).status).toBe(200);
      expect(await fx.onHand(t)).toBe(4);
      // Re-staged items stay PACKED: they cannot be sourced (and consumed) again.
      const again = await fx.source(order.id, order.itemIds[0]);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('ITEM_ALREADY_SOURCED');

      await fx.deliver(order.id, await fx.tempRider('replacement'));

      expect((await fx.orderRow(order.id)).order_status).toBe('DELIVERED');
      expect(await fx.onHand(t)).toBe(4);
      expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -2]]);
      await fx.expectLedgerChain(t);
    });

    it('hand-over, customer unavailable, re-stage and admin-marked delivery take nothing', async () => {
      const { t, order } = await packed(5, 1);
      expect((await fx.assign(order.id)).status).toBe(200);
      expect((await fx.setStatus(order.id, 'OUT_FOR_DELIVERY', undefined)).status).toBe(200);
      expect((await fx.setStatus(order.id, 'CUSTOMER_UNAVAILABLE', undefined, 'No answer after 3 calls')).status).toBe(200);
      expect((await fx.setStatus(order.id, 'PACKED', undefined, 'Back in store')).status).toBe(200);
      expect((await fx.assign(order.id)).status).toBe(200);
      expect((await fx.setStatus(order.id, 'OUT_FOR_DELIVERY', undefined)).status).toBe(200);
      expect((await fx.setStatus(order.id, 'DELIVERED', undefined, 'Cash handed in at the counter')).status).toBe(200);

      expect(await fx.onHand(t)).toBe(4);
      expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -1]]);
      await fx.expectLedgerChain(t);
    });

    it('abandoning a failed order (re-stage, then cancel) returns its stock (I3)', async () => {
      const { t, order } = await packed(6, 2);
      const d = (await fx.assign(order.id)).body.data.delivery.id;
      expect((await fx.riderStep(d, { status: 'PICKED_UP' })).status).toBe(200);
      expect((await fx.riderStep(d, { status: 'FAILED', failure_reason: 'Customer refused' })).status).toBe(200);
      expect((await fx.setStatus(order.id, 'PACKED', undefined, 'Back in store')).status).toBe(200);

      expect((await fx.adminCancel(order.id)).status).toBe(200);

      expect(await fx.onHand(t)).toBe(6);
      expect(await moves(order.id)).toEqual([
        ['ORDER_FULFILLMENT', -2],
        ['ORDER_CANCELLATION_RESTORE', 2],
      ]);
      await fx.expectLedgerChain(t);
    });

    it('a delivered order cannot be cancelled, so its stock stays taken', async () => {
      const { t, order } = await packed(3, 1);
      await fx.deliver(order.id);

      const byCustomer = await fx.customerCancel(order.id);
      expect(byCustomer.status).toBe(400);
      expect(byCustomer.body.error.code).toBe('ORDER_ALREADY_OUT_FOR_DELIVERY');
      expect((await fx.adminCancel(order.id)).status).toBe(422);

      expect(await fx.onHand(t)).toBe(2);
      expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -1]]);
    });

    it('an order on the road cannot be cancelled by anyone', async () => {
      const { t, order } = await packed(3, 1);
      const d = (await fx.assign(order.id)).body.data.delivery.id;
      expect((await fx.riderStep(d, { status: 'PICKED_UP' })).status).toBe(200);

      expect((await fx.customerCancel(order.id)).status).toBe(400);
      expect((await fx.adminCancel(order.id)).status).toBe(422);

      expect(await fx.onHand(t)).toBe(2);
      expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -1]]);
      // Finish the attempt so the seeded rider is free for later tests.
      expect((await fx.riderStep(d, { status: 'ARRIVED_AT_CUSTOMER' })).status).toBe(200);
      expect((await fx.collect(d, (await fx.orderRow(order.id)).total)).status).toBe(200);
    });
  });

  describe('races (x5 each): no deadlock, only allowed outcomes, the ledger explains the count', () => {
    const REPS = 5;
    const code = (r: { body: { error?: { code: string } } }) => r.body.error?.code;
    const net = async (orderId: string) => (await fx.ledgerForOrder(orderId)).reduce((n, r) => n + r.quantity_delta, 0);
    const noServerError = (...rs: { status: number }[]) => rs.forEach((r) => expect(r.status).toBeLessThan(500));

    it.each(['customerCancel', 'adminCancel'] as const)('%s vs sourcing the same order', async (how) => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 5 });
        const order = await fx.placeOrder([{ product_id: t.productId, quantity: 2 }]);
        const [cancel, src] = await Promise.all([fx[how](order.id), fx.source(order.id, order.itemIds[0])]);
        noServerError(cancel, src);
        expect(cancel.status).toBe(200);
        if (src.status === 200) {
          expect(await moves(order.id)).toEqual([
            ['ORDER_FULFILLMENT', -2],
            ['ORDER_CANCELLATION_RESTORE', 2],
          ]);
        } else {
          expect([src.status, code(src)]).toEqual([400, 'ORDER_NOT_IN_SOURCING_STATE']);
          expect(await moves(order.id)).toEqual([]);
        }
        expect(await fx.onHand(t)).toBe(5);
        await fx.expectLedgerChain(t);
      });
    });

    it('customer cancel vs packing', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 4 });
        const order = await sourcedOrder(t, 3);
        const [cancel, pack] = await Promise.all([fx.customerCancel(order.id), fx.pack(order.id)]);
        noServerError(cancel, pack);
        expect(cancel.status).toBe(200);
        expect([200, 422]).toContain(pack.status);
        expect((await fx.orderRow(order.id)).order_status).toBe('CANCELLED');
        expect(await fx.onHand(t)).toBe(4);
        expect(await net(order.id)).toBe(0);
        await fx.expectLedgerChain(t);
      });
    });

    it('customer cancel vs admin cancel: one cancellation, one restore', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 4 });
        const order = await sourcedOrder(t, 2);
        const [byCustomer, byAdmin] = await Promise.all([fx.customerCancel(order.id), fx.adminCancel(order.id)]);
        noServerError(byCustomer, byAdmin);
        expect([byCustomer.status, byAdmin.status].filter((st) => st === 200)).toHaveLength(1);
        if (byCustomer.status !== 200) expect(code(byCustomer)).toBe('ORDER_ALREADY_CANCELLED');
        if (byAdmin.status !== 200) expect([byAdmin.status, code(byAdmin)]).toEqual([422, 'INVALID_STATUS_TRANSITION']);
        expect(await moves(order.id)).toEqual([
          ['ORDER_FULFILLMENT', -2],
          ['ORDER_CANCELLATION_RESTORE', 2],
        ]);
        expect(await fx.onHand(t)).toBe(4);
        await fx.expectLedgerChain(t);
      });
    });

    it('cancel vs a manual restock of the same product', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 6 });
        const order = await sourcedOrder(t, 2);
        const [cancel, restock] = await Promise.all([fx.customerCancel(order.id), fx.adjust(t.productId, 'PURCHASE_RESTOCK', 5)]);
        noServerError(cancel, restock);
        expect([cancel.status, restock.status]).toEqual([200, 200]);
        expect(await fx.onHand(t)).toBe(11);
        await fx.expectLedgerChain(t);
      });
    });

    it('two cancellations sharing two products, lines in opposite order', async () => {
      await repeat(REPS, async () => {
        const a = await fx.product({ onHand: 6 });
        const b = await fx.product({ onHand: 6 });
        const first = await fx.placeOrder([
          { product_id: a.productId, quantity: 1 },
          { product_id: b.productId, quantity: 2 },
        ]);
        const second = await fx.placeOrder([
          { product_id: b.productId, quantity: 1 },
          { product_id: a.productId, quantity: 2 },
        ]);
        await fx.sourceAll(first);
        await fx.sourceAll(second);
        const [c1, c2] = await Promise.all([fx.customerCancel(first.id), fx.adminCancel(second.id)]);
        noServerError(c1, c2);
        expect([c1.status, c2.status]).toEqual([200, 200]);
        expect([await fx.onHand(a), await fx.onHand(b)]).toEqual([6, 6]);
        await fx.expectLedgerChain(a);
        await fx.expectLedgerChain(b);
      });
    });

    it('sourcing two orders of the same product at once', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 10 });
        const o1 = await fx.placeOrder([{ product_id: t.productId, quantity: 2 }]);
        const o2 = await fx.placeOrder([{ product_id: t.productId, quantity: 3 }]);
        const [s1, s2] = await Promise.all([fx.source(o1.id, o1.itemIds[0]), fx.source(o2.id, o2.itemIds[0])]);
        expect([s1.status, s2.status]).toEqual([200, 200]);
        expect(await fx.onHand(t)).toBe(5);
        await fx.expectLedgerChain(t);
      });
    });

    it('two orders racing for the last units: one wins, stock never goes negative', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 3 });
        const o1 = await fx.placeOrder([{ product_id: t.productId, quantity: 2 }]);
        const o2 = await fx.placeOrder([{ product_id: t.productId, quantity: 2 }]);
        const results = await Promise.all([fx.source(o1.id, o1.itemIds[0]), fx.source(o2.id, o2.itemIds[0])]);
        noServerError(...results);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(code(results.find((r) => r.status === 409)!)).toBe('INSUFFICIENT_TRACKED_INVENTORY');
        expect(await fx.onHand(t)).toBe(1);
        await fx.expectLedgerChain(t);
      });
    });

    it('cancel vs switching tracking off: the taken units still come back (I5)', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 5 });
        const order = await sourcedOrder(t, 2);
        const [cancel] = await Promise.all([fx.customerCancel(order.id), fx.setMode(t.productId, 'UNTRACKED')]);
        expect(cancel.status).toBe(200);
        expect(await fx.onHand(t)).toBe(5);
        expect(await net(order.id)).toBe(0);
        await fx.expectLedgerChain(t);
      });
    });

    it('rider failure vs a manual write-off: failure moves nothing', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 6 });
        const order = await sourcedOrder(t, 2);
        expect((await fx.pack(order.id)).status).toBe(200);
        const d = (await fx.assign(order.id)).body.data.delivery.id;
        expect((await fx.riderStep(d, { status: 'PICKED_UP' })).status).toBe(200);
        const [fail, writeOff] = await Promise.all([
          fx.riderStep(d, { status: 'FAILED', failure_reason: 'Vehicle breakdown' }),
          fx.adjust(t.productId, 'DAMAGE_WRITE_OFF', -1),
        ]);
        expect([fail.status, writeOff.status]).toEqual([200, 200]);
        expect(await fx.onHand(t)).toBe(3);
        expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -2]]);
        await fx.expectLedgerChain(t);
      });
    });

    it('re-stage vs a manual restock: re-stage moves nothing', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 6 });
        const order = await sourcedOrder(t, 2);
        expect((await fx.pack(order.id)).status).toBe(200);
        const d = (await fx.assign(order.id)).body.data.delivery.id;
        expect((await fx.riderStep(d, { status: 'PICKED_UP' })).status).toBe(200);
        expect((await fx.riderStep(d, { status: 'FAILED', failure_reason: 'Customer refused' })).status).toBe(200);
        const [restage, restock] = await Promise.all([
          fx.setStatus(order.id, 'PACKED', undefined, 'Back in store'),
          fx.adjust(t.productId, 'PURCHASE_RESTOCK', 4),
        ]);
        expect([restage.status, restock.status]).toEqual([200, 200]);
        expect(await fx.onHand(t)).toBe(8);
        expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -2]]);
        await fx.expectLedgerChain(t);
      });
    });

    it('the same item sourced twice at once: one fulfilment', async () => {
      await repeat(REPS, async () => {
        const t = await fx.product({ onHand: 5 });
        const order = await fx.placeOrder([{ product_id: t.productId, quantity: 2 }]);
        const results = await Promise.all([fx.source(order.id, order.itemIds[0]), fx.source(order.id, order.itemIds[0])]);
        noServerError(...results);
        expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(code(results.find((r) => r.status === 409)!)).toBe('ITEM_ALREADY_SOURCED');
        expect(await moves(order.id)).toEqual([['ORDER_FULFILLMENT', -2]]);
        expect(await fx.onHand(t)).toBe(3);
        await fx.expectLedgerChain(t);
      });
    });
  });

  describe('ledger attribution (I7)', () => {
    it('names who moved the stock and their role, so a customer is not mistaken for staff', async () => {
      const t = await fx.product({ onHand: 5 });
      const order = await sourcedOrder(t, 2);
      expect((await fx.customerCancel(order.id)).status).toBe(200);

      const list = await request(app).get('/api/v1/admin/inventory/adjustments').query({ product_id: t.productId }).set(auth(tokens.staff));
      expect(list.status).toBe(200);
      const byType = Object.fromEntries(list.body.data.adjustments.map((a: { adjustment_type: string }) => [a.adjustment_type, a]));
      expect(byType.ORDER_CANCELLATION_RESTORE).toMatchObject({ actor_name: 'Ahmed Rizvi', actor_role: 'CUSTOMER', quantity_delta: 2 });
      expect(byType.ORDER_FULFILLMENT).toMatchObject({ actor_role: 'PACKING_STAFF' });
      expect(byType.PURCHASE_RESTOCK).toMatchObject({ actor_role: 'ADMIN' });

      const detail = await request(app).get(`/api/v1/admin/inventory/${t.productId}`).set(auth(tokens.staff));
      expect(detail.status).toBe(200);
      expect(detail.body.data.adjustments[0]).toMatchObject({ adjustment_type: 'ORDER_CANCELLATION_RESTORE', actor_role: 'CUSTOMER' });
    });

    it('keeps the ledger away from customers', async () => {
      const res = await request(app).get('/api/v1/admin/inventory/adjustments').set(auth(tokens.customer));
      expect(res.status).toBe(403);
    });
  });

  describe('partial sourcing (I6)', () => {
    it('takes only what was bagged, keeps billing the full ordered quantity, and returns what was taken', async () => {
      const t = await fx.product({ onHand: 10 });
      const order = await fx.placeOrder([{ product_id: t.productId, quantity: 3 }]);
      const billed = await fx.orderRow(order.id);
      const line = async () =>
        (await pool.query('SELECT quantity, subtotal::float AS subtotal, unit_selling_price::float AS price FROM order_items WHERE id = $1', [order.itemIds[0]])).rows[0];
      const billedLine = await line();

      expect((await fx.source(order.id, order.itemIds[0], { quantity: 2 })).status).toBe(200);

      expect(await fx.onHand(t)).toBe(8);
      // The customer is still billed for the 3 ordered (documented limitation, plan F8).
      expect(await fx.orderRow(order.id)).toEqual(billed);
      expect(await line()).toEqual(billedLine);
      expect(billedLine.quantity).toBe(3);
      expect(billedLine.subtotal).toBeCloseTo(billedLine.price * 3, 2);
      expect(billed.subtotal).toBeGreaterThan(0);
      expect(billed.pay_amount).toBe(billed.total);

      expect((await fx.customerCancel(order.id)).status).toBe(200);
      expect(await fx.onHand(t)).toBe(10);
      expect(await moves(order.id)).toEqual([
        ['ORDER_FULFILLMENT', -2],
        ['ORDER_CANCELLATION_RESTORE', 2],
      ]);
    });
  });
});
