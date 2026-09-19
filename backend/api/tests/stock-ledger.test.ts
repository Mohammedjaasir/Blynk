import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'kysely';
import { createApp } from '../src/app.js';
import { db, pool } from '../src/database/connection.js';
import { STORE, users, stockFixtures } from './helpers/stock.js';

/**
 * The canonical stock writer (inventory plan §5, Task 2): one function moves
 * tracked stock and writes its ledger row, with before/after values, and the
 * row is stamped when the stock actually moved, so the ledger read in its own
 * order always explains the count.
 */
describe('Stock writer', () => {
  const app = createApp();
  const fx = stockFixtures(app, 'INTEG-LEDGER-');
  const writer = () => import('../src/modules/inventory/stock-ledger.js');

  beforeAll(fx.setup);
  afterAll(fx.cleanup);

  it('records one movement with its before/after values, reference and actor', async () => {
    const { lockInventoryRow, recordStockMovement } = await writer();
    const t = await fx.product({ onHand: 10 });
    const order = await fx.placeOrder([{ product_id: t.productId, quantity: 1 }]);

    const result = await db.transaction().execute(async (trx) => {
      const row = (await lockInventoryRow(trx, STORE, t.productId))!;
      return await recordStockMovement(trx, {
        inventory: row,
        delta: -4,
        type: 'ORDER_FULFILLMENT',
        orderId: order.id,
        actorId: users.staff.id,
        notes: 'writer test',
      });
    });

    expect(result.inventory.quantity_on_hand).toBe(6);
    expect(result.adjustment).toMatchObject({
      inventory_id: t.inventoryId,
      adjustment_type: 'ORDER_FULFILLMENT',
      quantity_delta: -4,
      previous_quantity: 10,
      new_quantity: 6,
      reference_order_id: order.id,
      created_by_user_id: users.staff.id,
      notes: 'writer test',
    });
    await fx.expectLedgerChain(t);
  });

  it('refuses to take stock below zero and writes nothing', async () => {
    const { lockInventoryRow, recordStockMovement } = await writer();
    const t = await fx.product({ onHand: 3 });
    await expect(
      db.transaction().execute(async (trx) => {
        const row = (await lockInventoryRow(trx, STORE, t.productId))!;
        await recordStockMovement(trx, { inventory: row, delta: -4, type: 'DAMAGE_WRITE_OFF', orderId: null, actorId: users.admin.id, notes: null });
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'NEGATIVE_INVENTORY_PROHIBITED' });
    expect(await fx.onHand(t)).toBe(3);
    expect(await fx.ledgerFor(t)).toHaveLength(1);
  });

  it('refuses to take stock below the reserved count and writes nothing', async () => {
    const { lockInventoryRow, recordStockMovement } = await writer();
    const t = await fx.product({ onHand: 5 });
    // Nothing in the system reserves stock; set it directly to exercise the rule.
    await pool.query('UPDATE inventory SET quantity_reserved = 3 WHERE id = $1', [t.inventoryId]);
    await expect(
      db.transaction().execute(async (trx) => {
        const row = (await lockInventoryRow(trx, STORE, t.productId))!;
        await recordStockMovement(trx, { inventory: row, delta: -3, type: 'DAMAGE_WRITE_OFF', orderId: null, actorId: users.admin.id, notes: null });
      })
    ).rejects.toMatchObject({ statusCode: 400, code: 'INSUFFICIENT_AVAILABLE_INVENTORY' });
    expect(await fx.onHand(t)).toBe(5);
    await pool.query('UPDATE inventory SET quantity_reserved = 0 WHERE id = $1', [t.inventoryId]);
  });

  it('stamps the ledger row when the stock moved, not when its transaction began', async () => {
    const { lockInventoryRow, recordStockMovement } = await writer();
    const t = await fx.product({ onHand: 2 });
    const { began, adjustment } = await db.transaction().execute(async (trx) => {
      const began = (await sql<{ t: Date }>`select now() as t`.execute(trx)).rows[0].t;
      await sql`select pg_sleep(0.05)`.execute(trx);
      const row = (await lockInventoryRow(trx, STORE, t.productId))!;
      const { adjustment } = await recordStockMovement(trx, { inventory: row, delta: 1, type: 'INVENTORY_AUDIT_ADJUSTMENT', orderId: null, actorId: users.admin.id, notes: null });
      return { began, adjustment };
    });
    expect(new Date(adjustment.created_at).getTime() - began.getTime()).toBeGreaterThanOrEqual(40);
  });

  it('keeps the ledger in movement order when an earlier transaction moves stock later (F3)', async () => {
    const t = await fx.product({ onHand: 20 });
    const first = await fx.placeOrder([{ product_id: t.productId, quantity: 2 }]);
    const second = await fx.placeOrder([{ product_id: t.productId, quantity: 3 }]);

    // Hold the first order's row so its sourcing starts first but has to wait;
    // the second order's sourcing then starts later and moves stock first.
    const holder = await pool.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [first.id]);
      const early = fx.source(first.id, first.itemIds[0]).then((r) => r);
      await new Promise((r) => setTimeout(r, 300));
      expect((await fx.source(second.id, second.itemIds[0])).status).toBe(200);
      await holder.query('COMMIT');
      expect((await early).status).toBe(200);
    } finally {
      holder.release();
    }

    expect(await fx.onHand(t)).toBe(15);
    await fx.expectLedgerChain(t);
  });
});
