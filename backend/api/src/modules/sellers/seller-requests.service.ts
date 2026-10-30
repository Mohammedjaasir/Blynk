import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { publicPhone } from '../../utils/phone.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { lockInventoryRow, recordStockMovement } from '../inventory/stock-ledger.js';
import { insertPayout, notifySeller, payoutDeclinedPush, payoutPaidPush } from './admin-sellers.service.js';
import { assertSellerRequestsReady } from './seller-requests.guard.js';
import { commissionContext, earnedSql, type CommissionContext } from './seller.commission.js';
import { sellerService } from './seller.service.js';
import { sellerStatement } from './seller.statement.js';
import {
  EXPECTED_MAX_DAYS_AHEAD,
  type CreatePayoutRequestInput,
  type CreateStockNoteInput,
  type PayPayoutRequestInput,
  type StaffPayoutRequestsQuery,
  type StaffStockNotesQuery,
} from './seller-requests.schema.js';

/**
 * What sellers start themselves and staff finish (owner, 2026-10-24: "sellers send stock updates
 * and payout requests themselves"; "a seller dashboard: best sellers this week so sellers know what
 * to restock"). Consignment model: Blynk holds the seller's stock, sells it, collects the cash and
 * pays the seller.
 *
 *   Stock notes (seller_stock_notes, migration 057)
 *     The seller announces goods: "20 of X on Tuesday" (POST /seller/stock-notes, APPROVED sellers,
 *     only their own products). Staff receive it with what actually arrived: that quantity goes onto
 *     the product's TRACKED stock through the canonical stock writer (stock-ledger.ts) as one
 *     PURCHASE_RESTOCK movement - so stock history, low-stock and back-in-stock alerts work exactly as
 *     for a restock typed in Inventory - and the seller gets an SMS. Either side may cancel a note
 *     that is still SENT.
 *     Since 2026-10-26 sellers type their own stock (seller.stock.ts) and the apps no longer use
 *     stock notes; these routes stay so an older Ops / Admin app keeps working, and receiving a note
 *     sends the seller nothing.
 *
 *   Payout requests (seller_payout_requests, migration 057)
 *     The seller asks to be paid: an amount up to what is due now (seller.statement.ts), bank or
 *     cash, one waiting request at a time. Staff pay it - a seller_payouts entry made by the same
 *     code as "Record payment" (admin-sellers.service insertPayout), linked to the request - or
 *     decline it with a reason; the seller may withdraw it while it waits. App notification (push) on
 *     paid / declined.
 *
 *   Insights (GET /seller/insights; no migration needed)
 *     Units and seller-price gross per product over the last N days (Colombo, today included), the
 *     N days before for comparison, stock on hand, days of stock left and a restock hint. Same item
 *     rules as the statement: DELIVERED orders, UNAVAILABLE / SUBSTITUTED items do not count.
 *
 * Migrations are run by hand in Coolify, so this code is live before 057 exists: until both tables
 * are there every stock-note / payout-request route answers 503 SELLER_REQUESTS_NOT_READY (never a
 * 500). Checked once a minute until found, then cached (the seller.location.ts pattern).
 */

type Trx = Transaction<Database>;
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const round1 = (n: number): number => Math.round((n + Number.EPSILON) * 10) / 10;

const assertReady = assertSellerRequestsReady;

// ----------------------------------------------------------------------------
// Dates (Asia/Colombo)
// ----------------------------------------------------------------------------

/** Today in Colombo as YYYY-MM-DD. */
export const colomboToday = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** YYYY-MM-DD plus n days (n may be negative). */
export function addDays(dayKey: string, n: number): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ----------------------------------------------------------------------------
// Money text (the app notifications live in admin-sellers.service.ts: payoutPaidPush, payoutDeclinedPush)
// ----------------------------------------------------------------------------

const smsLkr = (n: number) => `LKR ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ----------------------------------------------------------------------------
// Rows and presenters
// ----------------------------------------------------------------------------

interface StockNoteRow {
  id: string;
  seller_id: string;
  product_id: string;
  product_name: string;
  image_url: string | null;
  unit: string;
  pack_size: string | null;
  quantity: number;
  expected_on: string | null;
  note: string | null;
  status: 'SENT' | 'RECEIVED' | 'CANCELLED';
  received_quantity: number | null;
  received_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  stock_on_hand: string | null;
  shop_name: string;
  phone: string;
  email: string | null;
}

const stockNoteSelect = sql`
  SELECT n.id, n.seller_id, n.product_id, p.name AS product_name, p.image_url, p.unit, p.pack_size,
         n.quantity, to_char(n.expected_on, 'YYYY-MM-DD') AS expected_on, n.note, n.status,
         n.received_quantity, n.received_at, n.cancelled_at, n.created_at,
         (SELECT SUM(i.quantity_on_hand)::text FROM inventory i
           WHERE i.product_id = n.product_id AND i.tracking_mode = 'TRACKED') AS stock_on_hand,
         s.shop_name, u.phone, u.email
    FROM seller_stock_notes n
    JOIN products p ON p.id = n.product_id
    JOIN sellers s ON s.id = n.seller_id
    JOIN users u ON u.id = s.user_id`;

/** What the seller sees of a stock note. */
function presentStockNote(r: StockNoteRow) {
  return {
    id: r.id,
    product_id: r.product_id,
    product_name: r.product_name,
    image_url: r.image_url,
    unit: r.unit,
    pack_size: r.pack_size,
    quantity: r.quantity,
    expected_on: r.expected_on,
    note: r.note,
    status: r.status,
    received_quantity: r.received_quantity,
    received_at: r.received_at,
    cancelled_at: r.cancelled_at,
    created_at: r.created_at,
  };
}

/** What staff see: the seller and the product's stock now, too. */
function presentStaffStockNote(r: StockNoteRow) {
  return {
    ...presentStockNote(r),
    stock_on_hand: r.stock_on_hand === null ? null : Number(r.stock_on_hand),
    seller: { id: r.seller_id, shop_name: r.shop_name, phone: publicPhone(r.phone), email: r.email },
  };
}

async function stockNoteRow(executor: typeof db | Trx, id: string): Promise<StockNoteRow | undefined> {
  return (await sql<StockNoteRow>`${stockNoteSelect} WHERE n.id = ${id}`.execute(executor)).rows[0];
}

interface PayoutRequestRow {
  id: string;
  seller_id: string;
  amount: string;
  method: 'BANK' | 'CASH';
  bank_details: string | null;
  note: string | null;
  status: 'REQUESTED' | 'PAID' | 'DECLINED' | 'WITHDRAWN';
  decline_reason: string | null;
  payout_id: string | null;
  paid_on: string | null;
  handled_at: Date | null;
  created_at: Date;
  shop_name: string;
  phone: string;
  email: string | null;
  /** delivered sales less commission, line by line, free month included (seller.commission.ts) */
  earned: string;
  paid: string;
}

const payoutRequestSelect = (ctx: CommissionContext) => sql`
  SELECT r.id, r.seller_id, r.amount::text AS amount, r.method, r.bank_details, r.note, r.status,
         r.decline_reason, r.payout_id, to_char(sp.paid_on, 'YYYY-MM-DD') AS paid_on, r.handled_at, r.created_at,
         s.shop_name, u.phone, u.email,
         -- what is due now (seller.statement.ts rules: rates per line, the free month), for staff deciding
         ${earnedSql(sql`s.id`, ctx)} AS earned,
         (SELECT COALESCE(SUM(x.amount), 0)::text FROM seller_payouts x WHERE x.seller_id = s.id) AS paid
    FROM seller_payout_requests r
    JOIN sellers s ON s.id = r.seller_id
    JOIN users u ON u.id = s.user_id
    LEFT JOIN seller_payouts sp ON sp.id = r.payout_id`;

function presentPayoutRequest(r: PayoutRequestRow) {
  return {
    id: r.id,
    amount: round2(Number(r.amount)),
    method: r.method,
    bank_details: r.bank_details,
    note: r.note,
    status: r.status,
    decline_reason: r.decline_reason,
    payout_id: r.payout_id,
    paid_on: r.paid_on,
    handled_at: r.handled_at,
    created_at: r.created_at,
  };
}

function presentStaffPayoutRequest(r: PayoutRequestRow) {
  const earned = round2(Number(r.earned));
  return {
    ...presentPayoutRequest(r),
    seller: { id: r.seller_id, shop_name: r.shop_name, phone: publicPhone(r.phone), email: r.email },
    due: round2(earned - round2(Number(r.paid))),
  };
}

async function payoutRequestRow(executor: typeof db | Trx, id: string): Promise<PayoutRequestRow | undefined> {
  return (await sql<PayoutRequestRow>`${payoutRequestSelect(await commissionContext())} WHERE r.id = ${id}`.execute(executor)).rows[0];
}

const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === '23505';

const payoutRequestOpen = () =>
  new AppError('You already have a payout request waiting. Withdraw it or wait for Blynk to handle it.', 409, 'PAYOUT_REQUEST_OPEN');

// ----------------------------------------------------------------------------
// Seller side (/api/v1/seller)
// ----------------------------------------------------------------------------

function assertApproved(status: string): void {
  if (status !== 'APPROVED') {
    throw new AppError('Your seller account has not been approved yet.', 403, 'SELLER_NOT_APPROVED', { status });
  }
}

export async function createStockNote(userId: string, input: CreateStockNoteInput) {
  await assertReady();
  const seller = await sellerService.sellerOf(userId);
  assertApproved(seller.status);

  if (input.expected_on) {
    const today = colomboToday();
    if (input.expected_on < today) {
      throw new AppError('The day the goods arrive cannot be in the past.', 400, 'VALIDATION_ERROR', { field: 'expected_on' });
    }
    if (input.expected_on > addDays(today, EXPECTED_MAX_DAYS_AHEAD)) {
      throw new AppError(`Choose a day within the next ${EXPECTED_MAX_DAYS_AHEAD} days.`, 400, 'VALIDATION_ERROR', { field: 'expected_on' });
    }
  }
  const product = await db
    .selectFrom('products')
    .select('id')
    .where('id', '=', input.product_id)
    .where('seller_id', '=', seller.id)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!product) throw new AppError('Choose one of your products.', 404, 'PRODUCT_NOT_FOUND', { field: 'product_id' });

  const inserted = await sql<{ id: string }>`
    INSERT INTO seller_stock_notes (seller_id, product_id, quantity, expected_on, note)
    VALUES (${seller.id}, ${product.id}, ${input.quantity}, ${input.expected_on ?? null}, ${input.note ?? null})
    RETURNING id`.execute(db);
  const row = await stockNoteRow(db, inserted.rows[0]!.id);
  logger.info({ sellerId: seller.id, stockNoteId: row!.id, quantity: input.quantity }, 'Seller stock note sent');
  return { stock_note: presentStockNote(row!) };
}

export async function listSellerStockNotes(userId: string, status?: StockNoteRow['status']) {
  await assertReady();
  const seller = await sellerService.sellerOf(userId);
  const byStatus = status ? sql` AND n.status = ${status}` : sql``;
  const rows = (
    await sql<StockNoteRow>`${stockNoteSelect}
      WHERE n.seller_id = ${seller.id} ${byStatus}
      ORDER BY (n.status = 'SENT') DESC, n.created_at DESC, n.id DESC
      LIMIT 200`.execute(db)
  ).rows;
  return { stock_notes: rows.map(presentStockNote) };
}

/** The seller withdraws a note that is still SENT. */
export async function cancelOwnStockNote(userId: string, id: string) {
  await assertReady();
  const seller = await sellerService.sellerOf(userId);
  const updated = await sql<{ id: string }>`
    UPDATE seller_stock_notes SET status = 'CANCELLED', cancelled_by = ${userId}, cancelled_at = now(), updated_at = now()
     WHERE id = ${id} AND seller_id = ${seller.id} AND status = 'SENT'
    RETURNING id`.execute(db);
  if (updated.rows.length === 0) {
    const existing = await sql<{ status: string }>`
      SELECT status FROM seller_stock_notes WHERE id = ${id} AND seller_id = ${seller.id}`.execute(db);
    if (!existing.rows[0]) throw new AppError('Stock note not found.', 404, 'STOCK_NOTE_NOT_FOUND');
    throw new AppError('Only a stock note that is still on its way can be cancelled.', 409, 'STOCK_NOTE_NOT_OPEN', {
      status: existing.rows[0].status,
    });
  }
  return { stock_note: presentStockNote((await stockNoteRow(db, id))!) };
}

export async function createPayoutRequest(userId: string, input: CreatePayoutRequestInput) {
  await assertReady();
  const seller = await sellerService.sellerOf(userId);
  assertApproved(seller.status);

  let id: string;
  try {
    id = await db.transaction().execute(async (trx) => {
      // The seller row lock serialises two requests from the same seller (the unique index is the backstop).
      await trx.selectFrom('sellers').select('id').where('id', '=', seller.id).forUpdate().executeTakeFirstOrThrow();
      const open = await sql<{ id: string }>`
        SELECT id FROM seller_payout_requests WHERE seller_id = ${seller.id} AND status = 'REQUESTED'`.execute(trx);
      if (open.rows.length > 0) throw payoutRequestOpen();
      const { due } = await sellerStatement(seller.id);
      if (input.amount > due + 0.0001) {
        throw new AppError(
          due > 0 ? `You can ask for at most ${smsLkr(due)} (what Blynk owes you now).` : 'Blynk does not owe you anything right now.',
          400,
          'AMOUNT_OVER_DUE',
          { due: Math.max(due, 0), field: 'amount' }
        );
      }
      const r = await sql<{ id: string }>`
        INSERT INTO seller_payout_requests (seller_id, amount, method, bank_details, note)
        VALUES (${seller.id}, ${input.amount}, ${input.method}, ${input.bank_details ?? null}, ${input.note ?? null})
        RETURNING id`.execute(trx);
      return r.rows[0]!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw payoutRequestOpen();
    throw err;
  }
  logger.info({ sellerId: seller.id, payoutRequestId: id, amount: input.amount }, 'Seller payout requested');
  return { payout_request: presentPayoutRequest((await payoutRequestRow(db, id))!) };
}

/** The seller's requests (newest first; withdrawn ones are left out) and what is due now. */
export async function listSellerPayoutRequests(userId: string) {
  await assertReady();
  const seller = await sellerService.sellerOf(userId);
  const ctx = await commissionContext();
  const [rows, statement] = await Promise.all([
    sql<PayoutRequestRow>`${payoutRequestSelect(ctx)}
      WHERE r.seller_id = ${seller.id} AND r.status <> 'WITHDRAWN'
      ORDER BY (r.status = 'REQUESTED') DESC, r.created_at DESC, r.id DESC
      LIMIT 200`.execute(db),
    sellerStatement(seller.id),
  ]);
  return { payout_requests: rows.rows.map(presentPayoutRequest), due: statement.due };
}

/** The seller withdraws a request that is still waiting (it becomes WITHDRAWN). */
export async function withdrawPayoutRequest(userId: string, id: string) {
  await assertReady();
  const seller = await sellerService.sellerOf(userId);
  const updated = await sql<{ id: string }>`
    UPDATE seller_payout_requests SET status = 'WITHDRAWN', updated_at = now()
     WHERE id = ${id} AND seller_id = ${seller.id} AND status = 'REQUESTED'
    RETURNING id`.execute(db);
  if (updated.rows.length === 0) {
    const existing = await sql<{ status: string }>`
      SELECT status FROM seller_payout_requests WHERE id = ${id} AND seller_id = ${seller.id}`.execute(db);
    if (!existing.rows[0]) throw new AppError('Payout request not found.', 404, 'PAYOUT_REQUEST_NOT_FOUND');
    throw new AppError('Only a payout request that is still waiting can be withdrawn.', 409, 'PAYOUT_REQUEST_NOT_OPEN', {
      status: existing.rows[0].status,
    });
  }
  return { payout_request: presentPayoutRequest((await payoutRequestRow(db, id))!) };
}

// ----------------------------------------------------------------------------
// Insights (the seller dashboard)
// ----------------------------------------------------------------------------

export interface InsightLine {
  product_id: string;
  name: string;
  image_url: string | null;
  units: number;
  units_prev_period: number;
  gross: number;
  stock_on_hand: number | null;
  days_of_stock_left: number | null;
  restock_suggested: boolean;
}

export const INSIGHTS_TOP = 20;

/**
 * Best sellers over the last `days` days (today included, Colombo delivery date) next to the `days`
 * days before. `top` holds the seller's products sold in either period (most units first, at most
 * 20); `totals` cover every product. days_of_stock_left = stock / (units / days), one decimal, null
 * without sales in the period or without tracked stock; restock_suggested = stock < units sold in
 * the period (what sold in the period would not be covered again).
 */
export async function sellerInsights(userId: string, days: number) {
  const seller = await sellerService.sellerOf(userId);
  const to = colomboToday();
  const from = addDays(to, -(days - 1));
  const prevFrom = addDays(from, -days);

  const rows = (
    await sql<{
      product_id: string;
      name: string;
      image_url: string | null;
      units: string;
      units_prev: string;
      gross: string;
      stock_on_hand: string | null;
    }>`
      WITH sold AS (
        SELECT oi.product_id, oi.quantity, oi.estimated_unit_cost,
               (COALESCE(o.delivered_at, o.updated_at) AT TIME ZONE 'Asia/Colombo')::date AS day
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN products p ON p.id = oi.product_id
         WHERE p.seller_id = ${seller.id}
           AND o.order_status = 'DELIVERED'
           AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')
           AND (COALESCE(o.delivered_at, o.updated_at) AT TIME ZONE 'Asia/Colombo')::date BETWEEN ${prevFrom}::date AND ${to}::date
      ), per_product AS (
        SELECT product_id,
               COALESCE(SUM(quantity) FILTER (WHERE day >= ${from}::date), 0) AS units,
               COALESCE(SUM(quantity) FILTER (WHERE day < ${from}::date), 0) AS units_prev,
               COALESCE(SUM(quantity * estimated_unit_cost) FILTER (WHERE day >= ${from}::date), 0) AS gross
          FROM sold
         GROUP BY product_id
      )
      SELECT p.id AS product_id, p.name, p.image_url,
             pp.units::text AS units, pp.units_prev::text AS units_prev, pp.gross::text AS gross,
             (SELECT SUM(i.quantity_on_hand)::text FROM inventory i
               WHERE i.product_id = p.id AND i.tracking_mode = 'TRACKED') AS stock_on_hand
        FROM per_product pp
        JOIN products p ON p.id = pp.product_id
       ORDER BY pp.units DESC, pp.gross DESC, p.name ASC`.execute(db)
  ).rows;

  const lines: InsightLine[] = rows.map((r) => {
    const units = Number(r.units);
    const stock = r.stock_on_hand === null ? null : Number(r.stock_on_hand);
    return {
      product_id: r.product_id,
      name: r.name,
      image_url: r.image_url,
      units,
      units_prev_period: Number(r.units_prev),
      gross: round2(Number(r.gross)),
      stock_on_hand: stock,
      days_of_stock_left: stock === null || units === 0 ? null : round1(stock / (units / days)),
      restock_suggested: stock !== null && stock < units,
    };
  });

  return {
    period: { from, to },
    top: lines.slice(0, INSIGHTS_TOP),
    totals: {
      units: lines.reduce((n, l) => n + l.units, 0),
      gross: round2(lines.reduce((n, l) => n + l.gross, 0)),
      units_prev: lines.reduce((n, l) => n + l.units_prev_period, 0),
    },
  };
}

// ----------------------------------------------------------------------------
// Staff side (/api/v1/admin; ADMIN + OPERATIONS)
// ----------------------------------------------------------------------------

export async function listStockNotes(query: StaffStockNotesQuery) {
  await assertReady();
  const where = [sql`TRUE`];
  if (query.status !== 'ALL') where.push(sql`n.status = ${query.status}`);
  if (query.seller_id) where.push(sql`n.seller_id = ${query.seller_id}`);
  // Still coming: the soonest expected first (no day said = last). Otherwise the latest first.
  const order =
    query.status === 'SENT'
      ? sql`ORDER BY n.expected_on ASC NULLS LAST, n.created_at ASC, n.id ASC`
      : sql`ORDER BY (n.status = 'SENT') DESC, COALESCE(n.received_at, n.cancelled_at, n.created_at) DESC, n.id DESC`;
  const rows = (await sql<StockNoteRow>`${stockNoteSelect} WHERE ${sql.join(where, sql` AND `)} ${order} LIMIT 300`.execute(db)).rows;
  return { stock_notes: rows.map(presentStaffStockNote) };
}

async function lockStockNote(trx: Trx, id: string) {
  const note = (
    await sql<{ id: string; seller_id: string; product_id: string; quantity: number; status: string }>`
      SELECT id, seller_id, product_id, quantity, status FROM seller_stock_notes WHERE id = ${id} FOR UPDATE`.execute(trx)
  ).rows[0];
  if (!note) throw new AppError('Stock note not found.', 404, 'STOCK_NOTE_NOT_FOUND');
  if (note.status !== 'SENT') {
    throw new AppError('This stock note has already been received or cancelled.', 409, 'STOCK_NOTE_NOT_OPEN', { status: note.status });
  }
  return note;
}

/**
 * The goods arrived: `receivedQuantity` goes onto the product's TRACKED stock as one
 * PURCHASE_RESTOCK ledger row (the canonical stock writer, so back-in-stock alerts fire as for any
 * restock). A seller product without an inventory row gets a TRACKED one first (approved seller
 * products always have one); a product staff switched to UNTRACKED is refused - switch it back in
 * Inventory first.
 */
export async function receiveStockNote(id: string, receivedQuantity: number, actor: AuditActor) {
  await assertReady();
  const out = await db.transaction().execute(async (trx) => {
    const note = await lockStockNote(trx, id);
    const product = await trx
      .selectFrom('products')
      .select(['id', 'name', 'seller_id'])
      .where('id', '=', note.product_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!product) throw new AppError('The product of this stock note no longer exists.', 409, 'PRODUCT_NOT_FOUND');
    const seller = await trx.selectFrom('sellers').select(['id', 'shop_name', 'user_id']).where('id', '=', note.seller_id).executeTakeFirstOrThrow();

    let inventory = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, product.id);
    if (!inventory) {
      await trx.insertInto('inventory').values({ dark_store_id: DEFAULT_DARK_STORE_ID, product_id: product.id, tracking_mode: 'TRACKED' }).execute();
      inventory = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, product.id);
    }
    if (!inventory || inventory.tracking_mode !== 'TRACKED') {
      throw new AppError(
        'This product\'s stock is not counted (untracked). Switch it to tracked in Inventory, then receive the goods.',
        409,
        'PRODUCT_NOT_TRACKED',
        { product_id: product.id, tracking_mode: inventory?.tracking_mode ?? 'UNTRACKED' }
      );
    }
    const moved = await recordStockMovement(trx, {
      inventory,
      delta: receivedQuantity,
      type: 'PURCHASE_RESTOCK',
      orderId: null,
      actorId: actor.actorId,
      notes: `Seller stock from ${seller.shop_name} (stock note ${note.id.slice(0, 8)})`,
    });

    await sql`
      UPDATE seller_stock_notes
         SET status = 'RECEIVED', received_quantity = ${receivedQuantity}, received_by = ${actor.actorId},
             received_at = now(), updated_at = now()
       WHERE id = ${id}`.execute(trx);
    await writeAudit(trx, actor, {
      action: 'SELLER_STOCK_RECEIVED',
      entityType: 'SELLER_STOCK_NOTE',
      entityId: id,
      oldValues: { status: 'SENT', stock_on_hand: moved.adjustment.previous_quantity },
      newValues: {
        status: 'RECEIVED',
        seller_id: seller.id,
        product_id: product.id,
        quantity: note.quantity,
        received_quantity: receivedQuantity,
        stock_on_hand: moved.adjustment.new_quantity,
        adjustment_id: moved.adjustment.id,
      },
    });
    return { row: (await stockNoteRow(trx, id))! };
  });

  // No notification: sellers type their own stock now (seller.stock.ts), so there is nothing to tell them.
  logger.info({ stockNoteId: id, received: receivedQuantity, by: actor.actorId }, 'Seller stock received');
  const stockNote = presentStaffStockNote(out.row);
  return { stock_note: stockNote, stock_on_hand: stockNote.stock_on_hand };
}

/** The goods are not coming (or the note was a mistake). No SMS: the seller sees it in the seller site. */
export async function cancelStockNote(id: string, reason: string | null, actor: AuditActor) {
  await assertReady();
  const row = await db.transaction().execute(async (trx) => {
    const note = await lockStockNote(trx, id);
    await sql`
      UPDATE seller_stock_notes SET status = 'CANCELLED', cancelled_by = ${actor.actorId}, cancelled_at = now(), updated_at = now()
       WHERE id = ${id}`.execute(trx);
    await writeAudit(trx, actor, {
      action: 'SELLER_STOCK_NOTE_CANCELLED',
      entityType: 'SELLER_STOCK_NOTE',
      entityId: id,
      oldValues: { status: 'SENT' },
      newValues: { status: 'CANCELLED', seller_id: note.seller_id, product_id: note.product_id, quantity: note.quantity, reason },
    });
    return (await stockNoteRow(trx, id))!;
  });
  logger.info({ stockNoteId: id, by: actor.actorId }, 'Seller stock note cancelled by staff');
  return { stock_note: presentStaffStockNote(row) };
}

export async function listPayoutRequests(query: StaffPayoutRequestsQuery) {
  await assertReady();
  const where = [sql`TRUE`];
  if (query.status !== 'ALL') where.push(sql`r.status = ${query.status}`);
  if (query.seller_id) where.push(sql`r.seller_id = ${query.seller_id}`);
  const order =
    query.status === 'REQUESTED'
      ? sql`ORDER BY r.created_at ASC, r.id ASC`
      : sql`ORDER BY (r.status = 'REQUESTED') DESC, COALESCE(r.handled_at, r.created_at) DESC, r.id DESC`;
  const ctx = await commissionContext();
  const rows = (await sql<PayoutRequestRow>`${payoutRequestSelect(ctx)} WHERE ${sql.join(where, sql` AND `)} ${order} LIMIT 300`.execute(db)).rows;
  return { payout_requests: rows.map(presentStaffPayoutRequest) };
}

/** Locks a waiting request: 404 / 409 PAYOUT_REQUEST_NOT_OPEN. */
async function lockOpenRequest(trx: Trx, id: string) {
  const req = (
    await sql<{ id: string; seller_id: string; amount: string; method: 'BANK' | 'CASH'; status: string }>`
      SELECT id, seller_id, amount::text AS amount, method, status FROM seller_payout_requests WHERE id = ${id} FOR UPDATE`.execute(trx)
  ).rows[0];
  if (!req) throw new AppError('Payout request not found.', 404, 'PAYOUT_REQUEST_NOT_FOUND');
  if (req.status !== 'REQUESTED') {
    throw new AppError('This payout request has already been handled or withdrawn.', 409, 'PAYOUT_REQUEST_NOT_OPEN', { status: req.status });
  }
  return req;
}

/**
 * Staff paid the seller what they asked: a seller_payouts entry for the requested amount (the same
 * code and audit as "Record payment"), linked to the request, which becomes PAID. Refused with 409
 * AMOUNT_OVER_DUE when the amount is now more than what is due (a payment was recorded meanwhile):
 * decline it and let the seller ask again.
 */
export async function payPayoutRequest(id: string, input: PayPayoutRequestInput, actor: AuditActor) {
  await assertReady();
  const out = await db.transaction().execute(async (trx) => {
    // Seller row first, then the request: the order creating a request uses, so the two never deadlock.
    const peek = (await sql<{ seller_id: string }>`SELECT seller_id FROM seller_payout_requests WHERE id = ${id}`.execute(trx)).rows[0];
    if (!peek) throw new AppError('Payout request not found.', 404, 'PAYOUT_REQUEST_NOT_FOUND');
    const seller = await trx.selectFrom('sellers').select(['id', 'user_id']).where('id', '=', peek.seller_id).forUpdate().executeTakeFirstOrThrow();
    const req = await lockOpenRequest(trx, id);
    const amount = round2(Number(req.amount));
    const { due } = await sellerStatement(seller.id);
    if (amount > due + 0.0001) {
      throw new AppError(`The seller asked for ${smsLkr(amount)} but only ${smsLkr(Math.max(due, 0))} is due now.`, 409, 'AMOUNT_OVER_DUE', {
        due,
        amount,
      });
    }
    const payout = await insertPayout(
      trx,
      seller.id,
      { amount, note: input.note ?? `Payout request (${req.method === 'BANK' ? 'bank transfer' : 'cash'})`, paid_on: input.paid_on },
      actor,
      { payout_request_id: id }
    );
    await sql`
      UPDATE seller_payout_requests
         SET status = 'PAID', payout_id = ${payout.id}, handled_by = ${actor.actorId}, handled_at = now(), updated_at = now()
       WHERE id = ${id}`.execute(trx);
    await writeAudit(trx, actor, {
      action: 'SELLER_PAYOUT_REQUEST_PAID',
      entityType: 'SELLER_PAYOUT_REQUEST',
      entityId: id,
      oldValues: { status: 'REQUESTED' },
      newValues: { status: 'PAID', seller_id: seller.id, amount, method: req.method, payout_id: payout.id },
    });
    const user = await trx.selectFrom('users').select(['id', 'phone']).where('id', '=', seller.user_id).executeTakeFirstOrThrow();
    return { payout, user, sellerId: seller.id, amount, method: req.method, row: (await payoutRequestRow(trx, id))! };
  });

  await notifySeller(out.user, 'SELLER_PAYOUT_PAID', payoutPaidPush(out.amount, out.method), `seller-payout-paid:${id}`);
  logger.info({ payoutRequestId: id, payoutId: out.payout.id, by: actor.actorId }, 'Seller payout request paid');
  return { payout_request: presentStaffPayoutRequest(out.row), payout: out.payout, statement: await sellerStatement(out.sellerId) };
}

export async function declinePayoutRequest(id: string, reason: string, actor: AuditActor) {
  await assertReady();
  const out = await db.transaction().execute(async (trx) => {
    const req = await lockOpenRequest(trx, id);
    await sql`
      UPDATE seller_payout_requests
         SET status = 'DECLINED', decline_reason = ${reason}, handled_by = ${actor.actorId}, handled_at = now(), updated_at = now()
       WHERE id = ${id}`.execute(trx);
    await writeAudit(trx, actor, {
      action: 'SELLER_PAYOUT_REQUEST_DECLINED',
      entityType: 'SELLER_PAYOUT_REQUEST',
      entityId: id,
      oldValues: { status: 'REQUESTED' },
      newValues: { status: 'DECLINED', seller_id: req.seller_id, amount: round2(Number(req.amount)), reason },
    });
    const seller = await trx.selectFrom('sellers').select('user_id').where('id', '=', req.seller_id).executeTakeFirstOrThrow();
    const user = await trx.selectFrom('users').select(['id', 'phone']).where('id', '=', seller.user_id).executeTakeFirstOrThrow();
    return { user, amount: round2(Number(req.amount)), row: (await payoutRequestRow(trx, id))! };
  });
  await notifySeller(out.user, 'SELLER_PAYOUT_DECLINED', payoutDeclinedPush(out.amount, reason), `seller-payout-declined:${id}`);
  logger.info({ payoutRequestId: id, by: actor.actorId }, 'Seller payout request declined');
  return { payout_request: presentStaffPayoutRequest(out.row) };
}
