import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { publicPhone } from '../../utils/phone.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { lockStockRows, recordStockMovement, stockKeyOf } from '../inventory/stock-ledger.js';
import {
  purchaseOrderText,
  whatsappLink,
  whatsappPhone,
} from './purchase-orders.text.js';
import type {
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
  PatchPurchaseOrderInput,
  PoLineInput,
  ReceivePurchaseOrderInput,
} from './purchase-orders.schema.js';

/**
 * Purchase orders (migration 058; owner, 2026-10-25): DRAFT -> SENT -> PARTIAL -> RECEIVED, or
 * CANCELLED. Every state change is audited (PURCHASE_ORDER_CREATED / _UPDATED / _SENT /
 * _RECEIVED / _CANCELLED, and PURCHASE_ORDER_COST_UPDATED when a receive also updates a product's
 * purchase cost). Receiving puts the arrived quantity onto the product's TRACKED stock through the
 * stock ledger (one PURCHASE_RESTOCK row per line, all in one transaction with the order's own
 * change) - the same writer the seller stock receive and the Inventory restock use. A line whose
 * product is not counted (untracked / no stock row) is received on the order but adds no stock;
 * the answer says so.
 */
type Trx = Transaction<Database>;
type Exec = Trx | typeof db;

export type PoStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
const OPEN_STATUSES: readonly PoStatus[] = ['DRAFT', 'SENT', 'PARTIAL'];

const money = (v: unknown) => Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;

interface OrderRow {
  id: string;
  po_number: string;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_phone: string | null;
  status: PoStatus;
  notes: string | null;
  expected_on: string | null;
  created_by: string | null;
  created_by_name: string | null;
  sent_at: Date | null;
  received_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ItemRow {
  id: string;
  product_id: string;
  variant_id: string | null;
  name_snapshot: string;
  unit_snapshot: string | null;
  ordered_qty: number;
  received_qty: number;
  unit_cost: string;
  note: string | null;
  tracked: boolean;
  stock_on_hand: number | null;
}

const ORDER_COLUMNS = sql`
  po.id, po.po_number, po.supplier_id, s.name AS supplier_name, s.contact_phone AS supplier_phone, po.status, po.notes,
  to_char(po.expected_on, 'YYYY-MM-DD') AS expected_on, po.created_by, u.full_name AS created_by_name,
  po.sent_at, po.received_at, po.cancelled_at, po.cancel_reason, po.created_at, po.updated_at`;

async function orderRow(ex: Exec, id: string, lock = false): Promise<OrderRow | undefined> {
  const r = await sql<OrderRow>`
    SELECT ${ORDER_COLUMNS}
      FROM purchase_orders po
      LEFT JOIN suppliers s ON s.id = po.supplier_id
      LEFT JOIN users u ON u.id = po.created_by
     WHERE po.id = ${id}
     ${lock ? sql`FOR UPDATE OF po` : sql``}`.execute(ex);
  return r.rows[0];
}

async function itemRows(ex: Exec, id: string): Promise<ItemRow[]> {
  return (
    await sql<ItemRow>`
      SELECT poi.id, poi.product_id, poi.variant_id, poi.name_snapshot, poi.unit_snapshot, poi.ordered_qty, poi.received_qty,
             poi.unit_cost::text AS unit_cost, poi.note,
             COALESCE(inv.tracking_mode = 'TRACKED', FALSE) AS tracked,
             CASE WHEN inv.tracking_mode = 'TRACKED' THEN inv.quantity_on_hand END AS stock_on_hand
        FROM purchase_order_items poi
        LEFT JOIN inventory inv ON inv.product_id = poi.product_id AND inv.variant_id IS NOT DISTINCT FROM poi.variant_id
                               AND inv.dark_store_id = ${DEFAULT_DARK_STORE_ID}
       WHERE poi.purchase_order_id = ${id}
       ORDER BY poi.created_at, poi.name_snapshot, poi.id`.execute(ex)
  ).rows;
}

function presentItem(i: ItemRow) {
  const unitCost = money(i.unit_cost);
  return {
    id: i.id,
    product_id: i.product_id,
    variant_id: i.variant_id,
    name: i.name_snapshot,
    unit: i.unit_snapshot,
    ordered_qty: i.ordered_qty,
    received_qty: i.received_qty,
    remaining_qty: Math.max(0, i.ordered_qty - i.received_qty),
    unit_cost: unitCost,
    line_total: money(unitCost * i.ordered_qty),
    note: i.note,
    stock_counted: i.tracked,
    stock_on_hand: i.stock_on_hand,
  };
}

function presentOrder(o: OrderRow, items: ItemRow[]) {
  const lines = items.map(presentItem);
  const phone = publicPhone(o.supplier_phone);
  const text = purchaseOrderText({
    supplier_name: o.supplier_name,
    po_number: o.po_number,
    expected_on: o.expected_on,
    notes: o.notes,
    lines: lines.map((l) => ({ name: l.name, quantity: l.ordered_qty })),
  });
  return {
    id: o.id,
    po_number: o.po_number,
    supplier_id: o.supplier_id,
    supplier_name: o.supplier_name,
    supplier_phone: phone,
    status: o.status,
    notes: o.notes,
    expected_on: o.expected_on,
    created_by: o.created_by,
    created_by_name: o.created_by_name,
    sent_at: o.sent_at,
    received_at: o.received_at,
    cancelled_at: o.cancelled_at,
    cancel_reason: o.cancel_reason,
    created_at: o.created_at,
    updated_at: o.updated_at,
    lines,
    totals: totalsOf(lines),
    share: {
      text,
      whatsapp_url: whatsappPhone(phone) ? whatsappLink(text, phone) : null,
    },
  };
}

function totalsOf(lines: ReturnType<typeof presentItem>[]) {
  return {
    lines: lines.length,
    units_ordered: lines.reduce((n, l) => n + l.ordered_qty, 0),
    units_received: lines.reduce((n, l) => n + l.received_qty, 0),
    cost_ordered: money(lines.reduce((n, l) => n + l.line_total, 0)),
    cost_received: money(lines.reduce((n, l) => n + l.unit_cost * l.received_qty, 0)),
  };
}

async function detail(ex: Exec, id: string) {
  const order = await orderRow(ex, id);
  if (!order) throw new AppError('Purchase order not found.', 404, 'PURCHASE_ORDER_NOT_FOUND');
  return presentOrder(order, await itemRows(ex, id));
}

async function lockedOrder(trx: Trx, id: string): Promise<OrderRow> {
  const order = await orderRow(trx, id, true);
  if (!order) throw new AppError('Purchase order not found.', 404, 'PURCHASE_ORDER_NOT_FOUND');
  return order;
}

async function assertSupplier(ex: Exec, supplierId: string): Promise<void> {
  const r = await sql<{ id: string }>`SELECT id FROM suppliers WHERE id = ${supplierId}`.execute(ex);
  if (!r.rows[0]) throw new AppError('That supplier does not exist.', 404, 'SUPPLIER_NOT_FOUND');
}

interface ResolvedLine {
  product_id: string;
  variant_id: string | null;
  name: string;
  unit: string | null;
  ordered_qty: number;
  unit_cost: number;
  note: string | null;
}

/** Checks the lines against the catalogue and fills in name, unit and the default cost. */
async function resolveLines(ex: Exec, lines: PoLineInput[]): Promise<ResolvedLine[]> {
  const seen = new Set<string>();
  for (const l of lines) {
    const key = stockKeyOf({ product_id: l.product_id, variant_id: l.variant_id ?? null });
    if (seen.has(key)) throw new AppError('A product is on the order twice. Combine the quantities.', 400, 'DUPLICATE_LINE', { product_id: l.product_id });
    seen.add(key);
  }
  const ids = [...new Set(lines.map((l) => l.product_id))];
  const products = (
    await sql<{ id: string; name: string; unit: string; pack_size: string | null; purchase_cost: string; seller_id: string | null }>`
      SELECT id, name, unit, pack_size, purchase_cost::text AS purchase_cost, seller_id
        FROM products WHERE id IN (${sql.join(ids)}) AND deleted_at IS NULL`.execute(ex)
  ).rows;
  const byId = new Map(products.map((p) => [p.id, p]));
  const variantIds = [...new Set(lines.map((l) => l.variant_id).filter((v): v is string => !!v))];
  const variants = variantIds.length
    ? (
        await sql<{ id: string; product_id: string; label: string; purchase_cost: string }>`
          SELECT id, product_id, label, purchase_cost::text AS purchase_cost
            FROM product_variants WHERE id IN (${sql.join(variantIds)}) AND deleted_at IS NULL`.execute(ex)
      ).rows
    : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));

  return lines.map((l) => {
    const p = byId.get(l.product_id);
    if (!p) throw new AppError('A product on the order no longer exists.', 400, 'PRODUCT_NOT_FOUND', { product_id: l.product_id });
    if (p.seller_id) {
      throw new AppError(`${p.name} belongs to a seller. Its stock arrives with the seller's stock note, not a purchase order.`, 400, 'SELLER_PRODUCT', {
        product_id: p.id,
      });
    }
    let name = p.name;
    let cost = money(p.purchase_cost);
    let unit: string | null = p.pack_size || p.unit || null;
    if (l.variant_id) {
      const v = variantById.get(l.variant_id);
      if (!v || v.product_id !== p.id) {
        throw new AppError('A size on the order does not belong to its product.', 400, 'VARIANT_NOT_FOUND', { variant_id: l.variant_id });
      }
      name = `${p.name} - ${v.label}`;
      cost = money(v.purchase_cost);
      unit = null; // the size is the variant label, already in the name
    } else if (unit && name.toLowerCase().includes(unit.toLowerCase())) {
      unit = null;
    }
    return {
      product_id: p.id,
      variant_id: l.variant_id ?? null,
      name,
      unit,
      ordered_qty: l.ordered_qty,
      unit_cost: l.unit_cost !== undefined ? money(l.unit_cost) : cost,
      note: l.note ?? null,
    };
  });
}

async function insertLines(trx: Trx, orderId: string, lines: ResolvedLine[]): Promise<void> {
  for (const l of lines) {
    await sql`
      INSERT INTO purchase_order_items (purchase_order_id, product_id, variant_id, name_snapshot, unit_snapshot, ordered_qty, unit_cost, note)
      VALUES (${orderId}, ${l.product_id}, ${l.variant_id}, ${l.name}, ${l.unit}, ${l.ordered_qty}, ${l.unit_cost}, ${l.note})`.execute(trx);
  }
}

const auditSummary = (o: { po_number: string; supplier_id: string | null; status: string }, lines?: { ordered_qty: number }[]) => ({
  po_number: o.po_number,
  supplier_id: o.supplier_id,
  status: o.status,
  ...(lines ? { lines: lines.length, units: lines.reduce((n, l) => n + l.ordered_qty, 0) } : {}),
});

// ----------------------------------------------------------------------------
// Create / edit
// ----------------------------------------------------------------------------

export async function createPurchaseOrder(input: CreatePurchaseOrderInput, actor: AuditActor) {
  const id = await db.transaction().execute(async (trx) => {
    if (input.supplier_id) await assertSupplier(trx, input.supplier_id);
    const lines = await resolveLines(trx, input.lines);
    const created = (
      await sql<{ id: string; po_number: string }>`
        INSERT INTO purchase_orders (supplier_id, notes, expected_on, created_by)
        VALUES (${input.supplier_id ?? null}, ${input.notes ?? null}, ${input.expected_on ?? null}, ${actor.actorId})
        RETURNING id, po_number`.execute(trx)
    ).rows[0]!;
    await insertLines(trx, created.id, lines);
    await writeAudit(trx, actor, {
      action: 'PURCHASE_ORDER_CREATED',
      entityType: 'PURCHASE_ORDER',
      entityId: created.id,
      newValues: auditSummary({ po_number: created.po_number, supplier_id: input.supplier_id ?? null, status: 'DRAFT' }, lines),
    });
    return created.id;
  });
  logger.info({ purchaseOrderId: id, by: actor.actorId }, 'Purchase order created');
  return { purchase_order: await detail(db, id) };
}

/**
 * Edits an order. Notes and the expected day may change while it is open (DRAFT, SENT, PARTIAL);
 * the supplier and the lines only while it is still a DRAFT (nothing has been sent to the supplier).
 */
export async function patchPurchaseOrder(id: string, input: PatchPurchaseOrderInput, actor: AuditActor) {
  await db.transaction().execute(async (trx) => {
    const order = await lockedOrder(trx, id);
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new AppError('This purchase order is closed and cannot be changed.', 409, 'PURCHASE_ORDER_CLOSED', { status: order.status });
    }
    if (order.status !== 'DRAFT' && (input.supplier_id !== undefined || input.lines !== undefined)) {
      throw new AppError('The supplier and the products can only be changed while the order is a draft.', 409, 'PURCHASE_ORDER_NOT_DRAFT', {
        status: order.status,
      });
    }
    if (input.supplier_id) await assertSupplier(trx, input.supplier_id);
    const lines = input.lines ? await resolveLines(trx, input.lines) : null;

    const before = { supplier_id: order.supplier_id, expected_on: order.expected_on, notes: order.notes };
    const next = {
      supplier_id: input.supplier_id !== undefined ? input.supplier_id : order.supplier_id,
      expected_on: input.expected_on !== undefined ? input.expected_on : order.expected_on,
      notes: input.notes !== undefined ? input.notes : order.notes,
    };
    await sql`
      UPDATE purchase_orders SET supplier_id = ${next.supplier_id}, expected_on = ${next.expected_on}, notes = ${next.notes}, updated_at = now()
       WHERE id = ${id}`.execute(trx);
    if (lines) {
      await sql`DELETE FROM purchase_order_items WHERE purchase_order_id = ${id}`.execute(trx);
      await insertLines(trx, id, lines);
    }
    await writeAudit(trx, actor, {
      action: 'PURCHASE_ORDER_UPDATED',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      oldValues: { po_number: order.po_number, ...before },
      newValues: { po_number: order.po_number, ...next, ...(lines ? { lines: lines.length, units: lines.reduce((n, l) => n + l.ordered_qty, 0) } : {}) },
    });
  });
  return { purchase_order: await detail(db, id) };
}

// ----------------------------------------------------------------------------
// Read
// ----------------------------------------------------------------------------

export async function listPurchaseOrders(q: ListPurchaseOrdersQuery) {
  const where = [sql`TRUE`];
  if (q.status === 'OPEN') where.push(sql`po.status IN ('DRAFT', 'SENT', 'PARTIAL')`);
  else if (q.status !== 'ALL') where.push(sql`po.status = ${q.status}`);
  if (q.supplier_id) where.push(sql`po.supplier_id = ${q.supplier_id}`);
  if (q.search) {
    const like = `%${q.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(po.po_number ILIKE ${like} OR s.name ILIKE ${like})`);
  }
  const cond = sql.join(where, sql` AND `);
  const offset = (q.page - 1) * q.limit;

  const total = (
    await sql<{ n: number }>`SELECT count(*)::int AS n FROM purchase_orders po LEFT JOIN suppliers s ON s.id = po.supplier_id WHERE ${cond}`.execute(db)
  ).rows[0]!.n;
  const rows = (
    await sql<
      OrderRow & { line_count: number; units_ordered: string; units_received: string; cost_ordered: string }
    >`
      SELECT ${ORDER_COLUMNS},
             (SELECT count(*)::int FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS line_count,
             (SELECT COALESCE(SUM(i.ordered_qty), 0)::text FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS units_ordered,
             (SELECT COALESCE(SUM(i.received_qty), 0)::text FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS units_received,
             (SELECT COALESCE(SUM(i.ordered_qty * i.unit_cost), 0)::text FROM purchase_order_items i WHERE i.purchase_order_id = po.id) AS cost_ordered
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN users u ON u.id = po.created_by
       WHERE ${cond}
       ORDER BY (po.status IN ('DRAFT', 'SENT', 'PARTIAL')) DESC, po.created_at DESC, po.id DESC
       LIMIT ${q.limit} OFFSET ${offset}`.execute(db)
  ).rows;

  return {
    purchase_orders: rows.map((r) => ({
      id: r.id,
      po_number: r.po_number,
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      status: r.status,
      notes: r.notes,
      expected_on: r.expected_on,
      created_by_name: r.created_by_name,
      sent_at: r.sent_at,
      received_at: r.received_at,
      cancelled_at: r.cancelled_at,
      created_at: r.created_at,
      line_count: r.line_count,
      units_ordered: Number(r.units_ordered),
      units_received: Number(r.units_received),
      cost_ordered: money(r.cost_ordered),
    })),
    page: q.page,
    limit: q.limit,
    total,
  };
}

export async function getPurchaseOrder(id: string) {
  return { purchase_order: await detail(db, id) };
}

// ----------------------------------------------------------------------------
// Send / receive / cancel
// ----------------------------------------------------------------------------

/**
 * DRAFT -> SENT, and the text to share (also a wa.me link when the supplier has a phone). Sending
 * again a SENT or PARTIAL order only returns the text (nothing changes, nothing is audited).
 */
export async function sendPurchaseOrder(id: string, actor: AuditActor) {
  await db.transaction().execute(async (trx) => {
    const order = await lockedOrder(trx, id);
    if (order.status === 'SENT' || order.status === 'PARTIAL') return;
    if (order.status !== 'DRAFT') {
      throw new AppError('This purchase order is already closed.', 409, 'PURCHASE_ORDER_CLOSED', { status: order.status });
    }
    await sql`UPDATE purchase_orders SET status = 'SENT', sent_at = now(), sent_by = ${actor.actorId}, updated_at = now() WHERE id = ${id}`.execute(trx);
    await writeAudit(trx, actor, {
      action: 'PURCHASE_ORDER_SENT',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      oldValues: { status: 'DRAFT' },
      newValues: { status: 'SENT', po_number: order.po_number, supplier_id: order.supplier_id },
    });
  });
  const purchaseOrder = await detail(db, id);
  return { purchase_order: purchaseOrder, message: purchaseOrder.share.text, whatsapp_url: purchaseOrder.share.whatsapp_url };
}

export interface ReceivedLine {
  item_id: string;
  name: string;
  received_qty: number;
  stock_added: boolean;
  stock_on_hand: number | null;
  adjustment_id: string | null;
  /** Why no stock was added (the product is not counted); null when it was. */
  note: string | null;
}

/**
 * The goods arrived (all or part). Each line's `received_qty` is what came in THIS delivery: it is
 * added to the line's received total and, for a TRACKED product, onto its stock as one
 * PURCHASE_RESTOCK ledger row. `unit_cost` replaces the line's cost; `update_product_cost` also
 * makes it the product's (size's) purchase cost. The order becomes RECEIVED when every line has
 * arrived in full (or `close_short`), else PARTIAL. One transaction: any failure leaves the order
 * and the stock exactly as they were.
 */
export async function receivePurchaseOrder(id: string, input: ReceivePurchaseOrderInput, actor: AuditActor) {
  const received = await db.transaction().execute(async (trx) => {
    const order = await lockedOrder(trx, id);
    if (order.status !== 'SENT' && order.status !== 'PARTIAL') {
      throw new AppError(
        order.status === 'DRAFT' ? 'Mark the order as sent before receiving it.' : 'This purchase order is already closed.',
        409,
        'PURCHASE_ORDER_NOT_OPEN',
        { status: order.status }
      );
    }
    const items = await sql<{
      id: string;
      product_id: string;
      variant_id: string | null;
      name_snapshot: string;
      ordered_qty: number;
      received_qty: number;
      unit_cost: string;
    }>`SELECT id, product_id, variant_id, name_snapshot, ordered_qty, received_qty, unit_cost::text AS unit_cost
         FROM purchase_order_items WHERE purchase_order_id = ${id} ORDER BY id`.execute(trx);
    const itemById = new Map(items.rows.map((i) => [i.id, i]));

    const seen = new Set<string>();
    for (const l of input.lines) {
      if (!itemById.has(l.item_id)) throw new AppError('A line does not belong to this order.', 400, 'ITEM_NOT_ON_ORDER', { item_id: l.item_id });
      if (seen.has(l.item_id)) throw new AppError('A line is listed twice.', 400, 'DUPLICATE_LINE', { item_id: l.item_id });
      seen.add(l.item_id);
      if (l.update_product_cost && !(l.unit_cost !== undefined && l.unit_cost > 0)) {
        throw new AppError('Enter the unit cost to update the product cost.', 400, 'UNIT_COST_REQUIRED', { item_id: l.item_id });
      }
    }
    const arriving = input.lines.filter((l) => l.received_qty > 0);
    if (arriving.length === 0 && !input.close_short) {
      throw new AppError('Enter what arrived (at least one product).', 400, 'NOTHING_TO_RECEIVE');
    }

    // Stock rows locked together in ascending id (the canonical order), counted or not.
    const keys = arriving.map((l) => {
      const it = itemById.get(l.item_id)!;
      return { product_id: it.product_id, variant_id: it.variant_id ?? null };
    });
    const stock = await lockStockRows(trx, DEFAULT_DARK_STORE_ID, keys);

    const out: ReceivedLine[] = [];
    const costUpdates: { product_id: string; variant_id: string | null; from: number; to: number }[] = [];
    for (const l of input.lines) {
      const it = itemById.get(l.item_id)!;
      let moved: Awaited<ReturnType<typeof recordStockMovement>> | null = null;
      let note: string | null = null;
      if (l.received_qty > 0) {
        const inv = stock.get(stockKeyOf({ product_id: it.product_id, variant_id: it.variant_id ?? null }));
        if (inv && inv.tracking_mode === 'TRACKED') {
          moved = await recordStockMovement(trx, {
            inventory: inv,
            delta: l.received_qty,
            type: 'PURCHASE_RESTOCK',
            orderId: null,
            actorId: actor.actorId,
            notes: `Purchase order ${order.po_number}${order.supplier_name ? ` (${order.supplier_name})` : ''}`,
          });
        } else {
          note = 'Stock is not counted for this product (untracked), so no stock was added. Switch it to tracked in Inventory to count it.';
        }
      }
      const newCost = l.unit_cost !== undefined ? money(l.unit_cost) : money(it.unit_cost);
      await sql`
        UPDATE purchase_order_items
           SET received_qty = received_qty + ${l.received_qty}, unit_cost = ${newCost}, updated_at = now()
         WHERE id = ${l.item_id}`.execute(trx);

      if (l.update_product_cost && l.unit_cost !== undefined && l.unit_cost > 0) {
        const to = money(l.unit_cost);
        const from = it.variant_id
          ? money((await sql<{ c: string }>`SELECT purchase_cost::text AS c FROM product_variants WHERE id = ${it.variant_id}`.execute(trx)).rows[0]?.c)
          : money((await sql<{ c: string }>`SELECT purchase_cost::text AS c FROM products WHERE id = ${it.product_id}`.execute(trx)).rows[0]?.c);
        if (it.variant_id) {
          await sql`UPDATE product_variants SET purchase_cost = ${to}, updated_at = now() WHERE id = ${it.variant_id}`.execute(trx);
        } else {
          await sql`UPDATE products SET purchase_cost = ${to}, updated_at = now() WHERE id = ${it.product_id}`.execute(trx);
        }
        if (from !== to) {
          costUpdates.push({ product_id: it.product_id, variant_id: it.variant_id ?? null, from, to });
          await writeAudit(trx, actor, {
            action: 'PURCHASE_ORDER_COST_UPDATED',
            entityType: 'PRODUCT',
            entityId: it.product_id,
            oldValues: { purchase_cost: from, variant_id: it.variant_id ?? null },
            newValues: { purchase_cost: to, variant_id: it.variant_id ?? null, purchase_order: order.po_number },
          });
        }
      }
      out.push({
        item_id: l.item_id,
        name: it.name_snapshot,
        received_qty: l.received_qty,
        stock_added: moved !== null,
        stock_on_hand: moved ? moved.adjustment.new_quantity : null,
        adjustment_id: moved ? moved.adjustment.id : null,
        note,
      });
    }

    const totals = (
      await sql<{ open: number; any_received: boolean }>`
        SELECT count(*) FILTER (WHERE received_qty < ordered_qty)::int AS open,
               COALESCE(bool_or(received_qty > 0), FALSE) AS any_received
          FROM purchase_order_items WHERE purchase_order_id = ${id}`.execute(trx)
    ).rows[0]!;
    const status: PoStatus = input.close_short || totals.open === 0 ? 'RECEIVED' : totals.any_received ? 'PARTIAL' : order.status;
    await sql`
      UPDATE purchase_orders
         SET status = ${status}, updated_at = now(),
             received_at = CASE WHEN ${status} = 'RECEIVED' THEN now() ELSE received_at END
       WHERE id = ${id}`.execute(trx);

    await writeAudit(trx, actor, {
      action: 'PURCHASE_ORDER_RECEIVED',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      oldValues: { status: order.status },
      newValues: {
        status,
        po_number: order.po_number,
        close_short: input.close_short === true,
        lines: out.map((o) => ({
          item_id: o.item_id,
          received_qty: o.received_qty,
          stock_added: o.stock_added,
          adjustment_id: o.adjustment_id,
        })),
        cost_updates: costUpdates,
      },
    });
    return out;
  });

  logger.info({ purchaseOrderId: id, lines: received.length, by: actor.actorId }, 'Purchase order received');
  return {
    purchase_order: await detail(db, id),
    received: received.filter((r) => r.received_qty > 0),
    skipped: received.filter((r) => r.received_qty > 0 && !r.stock_added),
  };
}

export async function cancelPurchaseOrder(id: string, reason: string, actor: AuditActor) {
  await db.transaction().execute(async (trx) => {
    const order = await lockedOrder(trx, id);
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new AppError('This purchase order is already closed.', 409, 'PURCHASE_ORDER_CLOSED', { status: order.status });
    }
    await sql`
      UPDATE purchase_orders
         SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = ${actor.actorId}, cancel_reason = ${reason}, updated_at = now()
       WHERE id = ${id}`.execute(trx);
    await writeAudit(trx, actor, {
      action: 'PURCHASE_ORDER_CANCELLED',
      entityType: 'PURCHASE_ORDER',
      entityId: id,
      oldValues: { status: order.status },
      newValues: { status: 'CANCELLED', po_number: order.po_number, reason },
    });
  });
  return { purchase_order: await detail(db, id) };
}
