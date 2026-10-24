import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { lockInventoryRow, recordStockMovement } from '../inventory/stock-ledger.js';
import { assertExpiryReady, expiryReady } from './expiry.ready.js';
import {
  PUSH_WITHIN_DAYS,
  WEEK_DAYS,
  MONTH_DAYS,
  addDays,
  bucketRange,
  colomboToday,
  daysLeft,
  expiryLabel,
  expiryDateInRange,
  severityOf,
  type CreateBatchInput,
  type DiscardBatchInput,
  type ExpirySeverity,
  type ListBatchesQuery,
  type UpdateBatchInput,
} from './expiry.rules.js';

/**
 * Expiry dates (owner, 2026-10-25; migration 059): a register of received
 * batches and when they expire. See migrations/059_stock_batches.sql.
 *
 * Batches never move stock on their own. The one exception is DISCARD: it takes
 * the batch's remaining quantity off the product's tracked stock through the
 * canonical stock writer (a DAMAGE_WRITE_OFF ledger row), closes the batch and
 * writes the audit entry in ONE transaction. An expired ACTIVE batch never hides
 * or disables a product by itself.
 */
type Trx = Transaction<Database>;

// The single store (same default as modules/inventory/inventory.service.ts).
const DARK_STORE_ID = '018dc3f0-4a82-789a-8b1b-947f61ad8821';

export interface BatchView {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_unit: string;
  image_url: string | null;
  variant_id: string | null;
  variant_label: string | null;
  batch_code: string | null;
  quantity: number;
  expires_on: string;
  days_left: number;
  severity: ExpirySeverity;
  label: string;
  status: 'ACTIVE' | 'SOLD_OUT' | 'DISCARDED';
  note: string | null;
  received_at: string;
  created_by_name: string | null;
  sold_out_at: string | null;
  discarded_at: string | null;
  discard_reason: 'EXPIRED' | 'WASTE' | null;
  discard_stock_removed: number | null;
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

const baseQuery = (trx: Trx | typeof db = db) =>
  trx.selectFrom('stock_batches as b').innerJoin('products as p', 'p.id', 'b.product_id');

function detailed(q: ReturnType<typeof baseQuery>) {
  return q
    .leftJoin('product_variants as v', 'v.id', 'b.variant_id')
    .leftJoin('users as u', 'u.id', 'b.created_by')
    .select([
      'b.id',
      'b.product_id',
      'p.name as product_name',
      'p.sku as product_sku',
      'p.unit as product_unit',
      'p.image_url',
      'b.variant_id',
      'v.label as variant_label',
      'b.batch_code',
      'b.quantity',
      sql<string>`to_char(b.expires_on, 'YYYY-MM-DD')`.as('expires_on'),
      'b.status',
      'b.note',
      'b.received_at',
      'u.full_name as created_by_name',
      'b.sold_out_at',
      'b.discarded_at',
      'b.discard_reason',
      'b.discard_stock_removed',
    ]);
}

const batchQuery = (trx: Trx | typeof db = db) => detailed(baseQuery(trx));

function toView(row: Awaited<ReturnType<ReturnType<typeof batchQuery>['execute']>>[number], today: string): BatchView {
  return {
    id: row.id,
    product_id: row.product_id,
    product_name: row.product_name,
    product_sku: row.product_sku,
    product_unit: row.product_unit,
    image_url: row.image_url,
    variant_id: row.variant_id,
    variant_label: row.variant_label,
    batch_code: row.batch_code,
    quantity: row.quantity,
    expires_on: row.expires_on,
    days_left: daysLeft(row.expires_on, today),
    severity: severityOf(row.expires_on, today),
    label: expiryLabel(row.expires_on, today),
    status: row.status,
    note: row.note,
    received_at: new Date(row.received_at).toISOString(),
    created_by_name: row.created_by_name,
    sold_out_at: iso(row.sold_out_at),
    discarded_at: iso(row.discarded_at),
    discard_reason: row.discard_reason,
    discard_stock_removed: row.discard_stock_removed,
  };
}

async function viewOf(id: string, trx: Trx | typeof db = db): Promise<BatchView> {
  const row = await batchQuery(trx).where('b.id', '=', id).executeTakeFirst();
  if (!row) throw new AppError('Batch not found.', 404, 'BATCH_NOT_FOUND', { batch_id: id });
  return toView(row, colomboToday());
}

// ----------------------------------------------------------------------------
// Add
// ----------------------------------------------------------------------------
/**
 * Adds a batch inside the caller's transaction (also used by the restock call).
 * The product must exist (not deleted) and a variant must belong to it. A
 * product that gets a batch is switched to "track expiry dates" (a hint for
 * staff screens; it never blocks anything).
 */
export async function addBatchInTrx(trx: Trx, input: CreateBatchInput, actor: AuditActor | null): Promise<string> {
  const product = await trx
    .selectFrom('products')
    .select(['id', 'name'])
    .where('id', '=', input.product_id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND', { product_id: input.product_id });
  if (input.variant_id) {
    const v = await trx
      .selectFrom('product_variants')
      .select('id')
      .where('id', '=', input.variant_id)
      .where('product_id', '=', input.product_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!v) throw new AppError('Variant not found.', 404, 'VARIANT_NOT_FOUND', { variant_id: input.variant_id });
  }
  const row = await trx
    .insertInto('stock_batches')
    .values({
      product_id: input.product_id,
      variant_id: input.variant_id ?? null,
      batch_code: input.batch_code ?? null,
      quantity: input.quantity,
      expires_on: input.expires_on,
      note: input.note ?? null,
      created_by: actor?.actorId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await sql`UPDATE products SET expiry_tracking = true WHERE id = ${input.product_id} AND expiry_tracking = false`.execute(trx);
  if (actor) {
    await writeAudit(trx, actor, {
      action: 'EXPIRY_BATCH_ADDED',
      entityType: 'stock_batch',
      entityId: row.id,
      newValues: {
        product_id: input.product_id,
        variant_id: input.variant_id ?? null,
        batch_code: input.batch_code ?? null,
        quantity: input.quantity,
        expires_on: input.expires_on,
      },
    });
  }
  return row.id;
}

export async function addBatch(input: CreateBatchInput, actor: AuditActor): Promise<BatchView> {
  await assertExpiryReady();
  const id = await db.transaction().execute((trx) => addBatchInTrx(trx, input, actor));
  return await viewOf(id);
}

// ----------------------------------------------------------------------------
// List / summary
// ----------------------------------------------------------------------------
export async function listBatches(query: ListBatchesQuery, now: Date = new Date()) {
  await assertExpiryReady();
  const today = colomboToday(now);
  const range = bucketRange(query.bucket, today);
  const filtered = () => {
    let q = baseQuery().where('p.deleted_at', 'is', null).where('b.status', '=', query.status);
    if (query.product_id) q = q.where('b.product_id', '=', query.product_id);
    // History (sold out / discarded) is not a date bucket: every date is shown.
    if (query.status === 'ACTIVE') {
      if (range.from) q = q.where(sql<boolean>`b.expires_on >= ${range.from}::date`);
      if (range.to) q = q.where(sql<boolean>`b.expires_on <= ${range.to}::date`);
    }
    return q;
  };
  const countRow = await filtered().select(sql<number>`count(*)::int`.as('n')).executeTakeFirstOrThrow();
  const page = detailed(filtered());
  const ordered =
    query.status === 'ACTIVE'
      ? page.orderBy('b.expires_on', 'asc').orderBy('b.received_at', 'asc').orderBy('b.id', 'asc')
      : page.orderBy(sql`coalesce(b.discarded_at, b.sold_out_at, b.updated_at)`, 'desc').orderBy('b.id', 'asc');
  const rows = await ordered.limit(query.limit).offset((query.page - 1) * query.limit).execute();
  return {
    today,
    batches: rows.map((r) => toView(r, today)),
    total: countRow.n,
    page: query.page,
    limit: query.limit,
  };
}

export interface BucketCount {
  batches: number;
  units: number;
}
export interface ExpirySummary {
  today: string;
  expired: BucketCount;
  week: BucketCount;
  month: BucketCount;
  /** ACTIVE batches that expire within PUSH_WITHIN_DAYS days (today included), not counting expired ones. */
  within_3_days: number;
  total_active: number;
}

/** The "expiring soon" chips (Admin dashboard, Ops). ACTIVE batches of live products only. */
export async function expirySummary(now: Date = new Date()): Promise<ExpirySummary> {
  await assertExpiryReady();
  const today = colomboToday(now);
  const weekEnd = addDays(today, WEEK_DAYS);
  const monthEnd = addDays(today, MONTH_DAYS);
  const soonEnd = addDays(today, PUSH_WITHIN_DAYS);
  const r = await sql<{
    expired_b: number; expired_u: number; week_b: number; week_u: number; month_b: number; month_u: number; soon_b: number; total: number;
  }>`
    SELECT
      count(*) FILTER (WHERE b.expires_on < ${today}::date)::int AS expired_b,
      coalesce(sum(b.quantity) FILTER (WHERE b.expires_on < ${today}::date), 0)::int AS expired_u,
      count(*) FILTER (WHERE b.expires_on >= ${today}::date AND b.expires_on <= ${weekEnd}::date)::int AS week_b,
      coalesce(sum(b.quantity) FILTER (WHERE b.expires_on >= ${today}::date AND b.expires_on <= ${weekEnd}::date), 0)::int AS week_u,
      count(*) FILTER (WHERE b.expires_on > ${weekEnd}::date AND b.expires_on <= ${monthEnd}::date)::int AS month_b,
      coalesce(sum(b.quantity) FILTER (WHERE b.expires_on > ${weekEnd}::date AND b.expires_on <= ${monthEnd}::date), 0)::int AS month_u,
      count(*) FILTER (WHERE b.expires_on >= ${today}::date AND b.expires_on <= ${soonEnd}::date)::int AS soon_b,
      count(*)::int AS total
    FROM stock_batches b
    JOIN products p ON p.id = b.product_id AND p.deleted_at IS NULL
    WHERE b.status = 'ACTIVE'`.execute(db);
  const x = r.rows[0];
  return {
    today,
    expired: { batches: x?.expired_b ?? 0, units: x?.expired_u ?? 0 },
    week: { batches: x?.week_b ?? 0, units: x?.week_u ?? 0 },
    month: { batches: x?.month_b ?? 0, units: x?.month_u ?? 0 },
    within_3_days: x?.soon_b ?? 0,
    total_active: x?.total ?? 0,
  };
}

/**
 * For the daily report (the lead adds one line later):
 *  expired  ACTIVE batches already out of date
 *  within7  ACTIVE batches that expire today .. today + 7
 *  within30 ACTIVE batches that expire today .. today + 30 (includes within7)
 *  names    up to 5 product names, the most urgent first
 * All zeros (and no names) before migration 059; never throws.
 */
export async function expiryDigest(now: Date = new Date()): Promise<{ expired: number; within7: number; within30: number; names: string[] }> {
  const empty = { expired: 0, within7: 0, within30: 0, names: [] as string[] };
  try {
    if (!(await expiryReady())) return empty;
    const today = colomboToday(now);
    const wk = addDays(today, WEEK_DAYS);
    const mo = addDays(today, MONTH_DAYS);
    const r = await sql<{ expired: number; within7: number; within30: number }>`
      SELECT
        count(*) FILTER (WHERE b.expires_on < ${today}::date)::int AS expired,
        count(*) FILTER (WHERE b.expires_on >= ${today}::date AND b.expires_on <= ${wk}::date)::int AS within7,
        count(*) FILTER (WHERE b.expires_on >= ${today}::date AND b.expires_on <= ${mo}::date)::int AS within30
      FROM stock_batches b
      JOIN products p ON p.id = b.product_id AND p.deleted_at IS NULL
      WHERE b.status = 'ACTIVE'`.execute(db);
    const n = await sql<{ name: string }>`
      SELECT p.name FROM stock_batches b
      JOIN products p ON p.id = b.product_id AND p.deleted_at IS NULL
      WHERE b.status = 'ACTIVE' AND b.expires_on <= ${wk}::date
      GROUP BY p.id, p.name
      ORDER BY min(b.expires_on), p.name
      LIMIT 5`.execute(db);
    const x = r.rows[0];
    return { expired: x?.expired ?? 0, within7: x?.within7 ?? 0, within30: x?.within30 ?? 0, names: n.rows.map((row) => row.name) };
  } catch (err) {
    logger.warn({ err }, 'Could not read the expiry digest');
    return empty;
  }
}

// ----------------------------------------------------------------------------
// Edit / sold out / discard
// ----------------------------------------------------------------------------
async function lockBatch(trx: Trx, id: string) {
  const b = await trx
    .selectFrom('stock_batches')
    .selectAll()
    .select(sql<string>`to_char(expires_on, 'YYYY-MM-DD')`.as('expires_on_text'))
    .where('id', '=', id)
    .forUpdate()
    .executeTakeFirst();
  if (!b) throw new AppError('Batch not found.', 404, 'BATCH_NOT_FOUND', { batch_id: id });
  return b;
}

const notActive = (status: string) =>
  new AppError(`This batch is already ${status === 'SOLD_OUT' ? 'marked sold out' : 'discarded'}.`, 409, 'BATCH_NOT_ACTIVE', { status });

export async function updateBatch(id: string, input: UpdateBatchInput, actor: AuditActor): Promise<BatchView> {
  await assertExpiryReady();
  await db.transaction().execute(async (trx) => {
    const b = await lockBatch(trx, id);
    if (b.status !== 'ACTIVE') throw notActive(b.status);
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (input.batch_code !== undefined) set.batch_code = input.batch_code;
    if (input.quantity !== undefined) set.quantity = input.quantity;
    if (input.expires_on !== undefined) {
      if (!expiryDateInRange(input.expires_on, colomboToday())) {
        throw new AppError('The expiry date is too far in the past or future.', 400, 'VALIDATION_ERROR');
      }
      set.expires_on = input.expires_on;
    }
    if (input.note !== undefined) set.note = input.note;
    await trx.updateTable('stock_batches').set(set as never).where('id', '=', id).execute();
    await writeAudit(trx, actor, {
      action: 'EXPIRY_BATCH_UPDATED',
      entityType: 'stock_batch',
      entityId: id,
      oldValues: { batch_code: b.batch_code, quantity: b.quantity, expires_on: b.expires_on_text, note: b.note },
      newValues: {
        batch_code: input.batch_code ?? b.batch_code,
        quantity: input.quantity ?? b.quantity,
        expires_on: input.expires_on ?? b.expires_on_text,
        note: input.note === undefined ? b.note : input.note,
      },
    });
  });
  return await viewOf(id);
}

/** "Sold out": the batch is gone from the shelf (sold, not wasted); stock is not touched. */
export async function markSoldOut(id: string, actor: AuditActor): Promise<BatchView> {
  await assertExpiryReady();
  await db.transaction().execute(async (trx) => {
    const b = await lockBatch(trx, id);
    if (b.status !== 'ACTIVE') throw notActive(b.status);
    await trx.updateTable('stock_batches').set({ status: 'SOLD_OUT', sold_out_at: new Date(), updated_at: new Date() }).where('id', '=', id).execute();
    await writeAudit(trx, actor, {
      action: 'EXPIRY_BATCH_SOLD_OUT',
      entityType: 'stock_batch',
      entityId: id,
      oldValues: { status: 'ACTIVE' },
      newValues: { status: 'SOLD_OUT', quantity: b.quantity },
    });
  });
  return await viewOf(id);
}

/**
 * Throws away the batch's remaining quantity. For a TRACKED product (or
 * variant) the stock count goes down through the stock writer, as a
 * DAMAGE_WRITE_OFF ledger row, in the same transaction that closes the batch:
 *   removed = min(batch quantity, on hand - reserved), never below zero,
 * so a count that has already drifted below the batch never fails the discard
 * (the closed batch records how many units actually came off). An untracked
 * product has no count: nothing moves. `reduce_stock: false` only closes the batch.
 */
export async function discardBatch(id: string, input: DiscardBatchInput, actor: AuditActor) {
  await assertExpiryReady();
  const outcome = await db.transaction().execute(async (trx) => {
    const b = await lockBatch(trx, id);
    if (b.status !== 'ACTIVE') throw notActive(b.status);

    let removed = 0;
    let stock: { on_hand: number; reserved: number } | null = null;
    if (input.reduce_stock) {
      const inv = await lockInventoryRow(trx, DARK_STORE_ID, b.product_id, b.variant_id ?? null);
      if (inv && inv.tracking_mode === 'TRACKED') {
        removed = Math.max(0, Math.min(b.quantity, inv.quantity_on_hand - inv.quantity_reserved));
        if (removed > 0) {
          const where = b.batch_code ? `batch ${b.batch_code}` : 'batch';
          const moved = await recordStockMovement(trx, {
            inventory: inv,
            delta: -removed,
            type: 'DAMAGE_WRITE_OFF',
            orderId: null,
            actorId: actor.actorId,
            notes: `${input.reason === 'EXPIRED' ? 'Expired' : 'Waste'}: ${where} (expires ${b.expires_on_text}) discarded, ${removed} removed${input.note ? ` - ${input.note}` : ''}`.slice(0, 500),
          });
          stock = { on_hand: moved.inventory.quantity_on_hand, reserved: moved.inventory.quantity_reserved };
        } else {
          stock = { on_hand: inv.quantity_on_hand, reserved: inv.quantity_reserved };
        }
      }
    }

    const now = new Date();
    await trx
      .updateTable('stock_batches')
      .set({
        status: 'DISCARDED',
        discarded_at: now,
        discarded_by: actor.actorId,
        discard_reason: input.reason,
        discard_stock_removed: removed,
        ...(input.note ? { note: input.note } : {}),
        updated_at: now,
      })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, actor, {
      action: 'EXPIRY_BATCH_DISCARDED',
      entityType: 'stock_batch',
      entityId: id,
      oldValues: { status: 'ACTIVE', quantity: b.quantity },
      newValues: {
        status: 'DISCARDED',
        reason: input.reason,
        batch_quantity: b.quantity,
        stock_removed: removed,
        reduce_stock: input.reduce_stock,
        product_id: b.product_id,
        variant_id: b.variant_id,
        ...(stock ? { stock_on_hand_after: stock.on_hand } : {}),
      },
    });
    return { removed, stock };
  });
  return { batch: await viewOf(id), stock_removed: outcome.removed, stock: outcome.stock };
}

// ----------------------------------------------------------------------------
// Per product (the product form's switch)
// ----------------------------------------------------------------------------
export async function productExpiry(productId: string, now: Date = new Date()) {
  await assertExpiryReady();
  const p = await sql<{ id: string; name: string; expiry_tracking: boolean }>`
    SELECT id, name, expiry_tracking FROM products WHERE id = ${productId} AND deleted_at IS NULL`.execute(db);
  const product = p.rows[0];
  if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND', { product_id: productId });
  const today = colomboToday(now);
  const rows = await batchQuery().where('b.product_id', '=', productId).where('b.status', '=', 'ACTIVE').orderBy('b.expires_on', 'asc').orderBy('b.id', 'asc').execute();
  return { product_id: product.id, product_name: product.name, expiry_tracking: product.expiry_tracking, batches: rows.map((r) => toView(r, today)) };
}

export async function setProductExpiryTracking(productId: string, enabled: boolean, actor: AuditActor) {
  await assertExpiryReady();
  await db.transaction().execute(async (trx) => {
    const r = await sql<{ expiry_tracking: boolean }>`
      SELECT expiry_tracking FROM products WHERE id = ${productId} AND deleted_at IS NULL FOR UPDATE`.execute(trx);
    const row = r.rows[0];
    if (!row) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND', { product_id: productId });
    if (row.expiry_tracking === enabled) return;
    await sql`UPDATE products SET expiry_tracking = ${enabled}, updated_at = now() WHERE id = ${productId}`.execute(trx);
    await writeAudit(trx, actor, {
      action: 'PRODUCT_EXPIRY_TRACKING_UPDATED',
      entityType: 'product',
      entityId: productId,
      oldValues: { expiry_tracking: row.expiry_tracking },
      newValues: { expiry_tracking: enabled },
    });
  });
  return await productExpiry(productId);
}
