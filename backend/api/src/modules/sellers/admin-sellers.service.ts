import { sql, type Transaction } from 'kysely';
import { db } from '../../database/connection.js';
import type { Database } from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { publicPhone } from '../../utils/phone.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { catalogRepository } from '../catalog/catalog.repository.js';
import { catalogService } from '../catalog/catalog.service.js';
import { notifyCatalogChanged } from '../catalog/catalog.events.js';
import { assertOfferAllowed } from '../catalog/catalog.offers.js';
import { priceForProduct } from '../catalog/catalog.pricing.js';
import { generateUniqueSlug, randomSlugSuffix } from '../catalog/catalog.slugs.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { enqueuePush, PUSH_TYPES } from '../notifications/push/push.repository.js';
import { phoneHash } from '../users/phone-identity.js';
import { sellerStatement } from './seller.statement.js';
import {
  commissionContext,
  earnedSql,
  freeDaysLeft,
  freePeriodNotReady,
  freeUntilForApproval,
  hasCommissionFreeColumn,
  type CommissionContext,
} from './seller.commission.js';
import { hasSellerRequestTables, requestsNotReady } from './seller-requests.guard.js';
import {
  hasSellerLocationColumns,
  locationContext,
  locationNotReady,
  locationSelect,
  presentLocation,
  type LocationContext,
} from './seller.location.js';
import {
  submissionPayloadSchema,
  type ApproveSubmissionInput,
  type CreateSellerInput,
  type ListSellersQuery,
  type ListSubmissionsQuery,
  type PatchSellerInput,
  type RecordPayoutInput,
  type SubmissionPayload,
} from './admin-sellers.schema.js';

/**
 * Staff side of the seller portal (docs/superpowers/plans/2026-10-24-seller-portal.md, design in
 * docs/superpowers/specs/2026-10-23-seller-portal-design.md). Admin and Operations
 *   - approve / reject / suspend sellers and set their commission (PATCH /admin/sellers/:id),
 *   - review what sellers submit - a NEW product or an EDIT of a live one - and set the customer
 *     price when approving (POST /admin/seller-submissions/:id/approve | reject),
 *   - keep the payouts ledger (POST|DELETE /admin/sellers/:id/payouts).
 * Every change is one transaction with its audit row; the app notification (push) to the seller is
 * queued after the commit and a failure there never fails the request. Sellers get no SMS but the
 * sign-in code (owner, 2026-10-26).
 *
 * Rules worth knowing:
 *   - A seller is REJECTED only while PENDING, SUSPENDED only while APPROVED; re-approving a
 *     suspended seller does NOT switch their products back on (staff do that per product).
 *   - A submission can only be approved while its seller is APPROVED.
 *   - A NEW approval creates the product like Admin's create does (slug and SKU generated), at a
 *     FIXED customer price, purchase_cost = the seller's price, seller_id set, and a TRACKED
 *     inventory row at 0 - the product shows as sold out until the seller types their stock
 *     (PUT /seller/products/:id/stock, seller.stock.ts) or staff restock it in Inventory.
 *   - An EDIT applies the proposed fields to the live product (slug and SKU never change). The
 *     price only changes when the seller's price did (then the selling price is required) or when
 *     staff send one.
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
type Trx = Transaction<Database>;

// ----------------------------------------------------------------------------
// Presenters
// ----------------------------------------------------------------------------

interface SellerRow {
  id: string;
  shop_name: string;
  contact_name: string | null;
  address: string | null;
  note: string | null;
  status: string;
  rejection_reason: string | null;
  commission_percent: string | null;
  created_at: Date;
  user_id: string;
  phone: string;
  email: string | null;
  full_name: string | null;
  products_live: number;
  submissions_pending: number;
  /** delivered sales less commission, line by line (seller.commission.ts) */
  earned: string;
  paid: string;
  products_total: number;
  /** migration 065 (NULL until it has run) */
  commission_free_until: Date | null;
  // migration 053 (NULL / 'NONE' until it has run: locationSelect)
  latitude: number | null;
  longitude: number | null;
  location_note: string | null;
  pending_latitude: number | null;
  pending_longitude: number | null;
  pending_location_note: string | null;
  location_status: string;
  location_reject_reason: string | null;
}

function presentSeller(r: SellerRow, ctx: LocationContext) {
  // null = no own rate: each sale uses its category's rate or the default (seller.commission.ts)
  const pct = r.commission_percent === null ? null : Number(r.commission_percent);
  const earned = round2(Number(r.earned));
  return {
    id: r.id,
    shop_name: r.shop_name,
    contact_name: r.contact_name,
    address: r.address,
    note: r.note,
    status: r.status,
    rejection_reason: r.rejection_reason,
    commission_percent: pct,
    created_at: r.created_at,
    // null for a seller who signed up with an email (users.phone holds a 'nophone:' placeholder)
    phone: publicPhone(r.phone),
    email: r.email,
    full_name: r.full_name,
    products_live: Number(r.products_live),
    submissions_pending: Number(r.submissions_pending),
    // every product of the shop that is not deleted (live, paused or off)
    products_total: Number(r.products_total),
    // the commission-free month (migration 065): when it ends, and whole days left (0 once over; null = none)
    commission_free_until: r.commission_free_until ? new Date(r.commission_free_until).toISOString() : null,
    commission_free_days_left: freeDaysLeft(r.commission_free_until),
    due: round2(earned - round2(Number(r.paid))),
    // the shop pin: approved (used for delivery) and waiting (seller.location.ts)
    ...presentLocation(r as unknown as Record<string, unknown>, ctx),
  };
}

/** AdminSeller rows (one query for any number of sellers; `due` follows seller.statement's rules). */
async function sellerRows(
  executor: typeof db | Trx,
  where: ReturnType<typeof sql>[],
  located: boolean,
  commission: CommissionContext
): Promise<SellerRow[]> {
  const cond = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const r = await sql<SellerRow>`
    SELECT s.id, s.shop_name, s.contact_name, s.address, s.note, s.status, s.rejection_reason,
           s.commission_percent::text AS commission_percent, s.created_at, s.user_id, u.phone, u.email, u.full_name,
           ${locationSelect(located)},
           ${commission.free ? sql`s.commission_free_until AS commission_free_until` : sql`NULL::timestamptz AS commission_free_until`},
           (SELECT count(*)::int FROM products p WHERE p.seller_id = s.id AND p.deleted_at IS NULL) AS products_total,
           (SELECT count(*)::int FROM products p WHERE p.seller_id = s.id AND p.deleted_at IS NULL AND p.is_active) AS products_live,
           (SELECT count(*)::int FROM seller_submissions x WHERE x.seller_id = s.id AND x.status = 'PENDING') AS submissions_pending,
           ${earnedSql(sql`s.id`, commission)} AS earned,
           (SELECT COALESCE(SUM(amount), 0)::text FROM seller_payouts WHERE seller_id = s.id) AS paid
      FROM sellers s
      JOIN users u ON u.id = s.user_id
      ${cond}
     ORDER BY (s.status = 'PENDING') DESC, s.created_at DESC`.execute(executor);
  return r.rows;
}

export async function oneSeller(executor: typeof db | Trx, id: string) {
  const [ctx, commission] = await Promise.all([locationContext(), commissionContext()]);
  const [row] = await sellerRows(executor, [sql`s.id = ${id}`], ctx.columns, commission);
  if (!row) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');
  return presentSeller(row, ctx);
}

interface SubmissionRow {
  id: string;
  seller_id: string;
  product_id: string | null;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  seller_price: string;
  approved_selling_price: string | null;
  reject_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

function presentSubmission(r: SubmissionRow) {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    product_id: r.product_id,
    payload: r.payload,
    seller_price: Number(r.seller_price),
    approved_selling_price: r.approved_selling_price === null ? null : Number(r.approved_selling_price),
    reject_reason: r.reject_reason,
    created_at: r.created_at,
    reviewed_at: r.reviewed_at,
  };
}

// ----------------------------------------------------------------------------
// Notifications to the seller (app push, after the commit; never fails the request)
// ----------------------------------------------------------------------------

// Owner, 2026-10-26: sellers get an app notification (the installable seller site, web push through
// the existing push outbox), never an SMS - the sign-in code is the only SMS a seller receives.

const REASON_MAX = 120;
const reasonText = (reason: string) =>
  reason.length > REASON_MAX ? `${reason.slice(0, REASON_MAX - 3).trimEnd()}...` : reason;
const shortName = (name: string) => (name.length > 50 ? `${name.slice(0, 47).trimEnd()}...` : name);
const lkr = (n: number) => `LKR ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface SellerPushText {
  title: string;
  body: string;
}

export const sellerApprovedPush = (): SellerPushText => ({ title: 'Your seller account is approved', body: 'You can add products now.' });
export const sellerRejectedPush = (reason: string): SellerPushText => ({
  title: 'Seller application not approved',
  body: reasonText(reason),
});
export const productApprovedPush = (name: string): SellerPushText => ({
  title: `${shortName(name)} is live`,
  body: 'Customers can order it now.',
});
export const productRejectedPush = (name: string, reason: string): SellerPushText => ({
  title: `${shortName(name)} was not approved`,
  body: reasonText(reason),
});
export const payoutPaidPush = (amount: number, method: 'BANK' | 'CASH'): SellerPushText => ({
  title: 'Payment sent',
  body: `We paid you ${lkr(amount)} (${method === 'BANK' ? 'bank transfer' : 'cash'}).`,
});
export const payoutDeclinedPush = (amount: number, reason: string): SellerPushText => ({
  title: 'Payout request declined',
  body: `${lkr(amount)}: ${reasonText(reason)}`,
});

/** Every notification a seller gets (data.type of the push; the outbox type is PUSH_SELLER). */
export type SellerNotificationType =
  | 'SELLER_APPROVED'
  | 'SELLER_REJECTED'
  | 'SELLER_PRODUCT_APPROVED'
  | 'SELLER_PRODUCT_REJECTED'
  // migration 057 (seller-requests.service.ts)
  | 'SELLER_PAYOUT_PAID'
  | 'SELLER_PAYOUT_DECLINED';

/**
 * Queues the seller's app notification (a PUSH outbox row, sent to every device the seller turned
 * notifications on for; no device or push not set up = nothing queued). Tapping it opens the seller
 * site root. Best effort: a failure is logged and never fails the staff action.
 */
export async function notifySeller(user: { id: string }, type: SellerNotificationType, text: SellerPushText, key: string) {
  try {
    await enqueuePush(db, {
      userId: user.id,
      type: PUSH_TYPES.SELLER,
      idempotencyKey: key,
      payload: { title: text.title, body: text.body, data: { type, url: '/' } },
    });
  } catch (err) {
    logger.warn({ err, type }, 'Seller notification could not be queued');
  }
}

// ----------------------------------------------------------------------------
// Sellers
// ----------------------------------------------------------------------------

export async function listSellers(query: ListSellersQuery) {
  const where: ReturnType<typeof sql>[] = [];
  if (query.status) where.push(sql`s.status = ${query.status}`);
  if (query.search) {
    const like = `%${query.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(s.shop_name ILIKE ${like} OR (u.phone NOT LIKE 'nophone:%' AND u.phone ILIKE ${like}) OR u.email ILIKE ${like} OR s.contact_name ILIKE ${like} OR u.full_name ILIKE ${like})`);
  }
  const [ctx, commission] = await Promise.all([locationContext(), commissionContext()]);
  return { sellers: (await sellerRows(db, where, ctx.columns, commission)).map((r) => presentSeller(r, ctx)) };
}

export async function getSeller(id: string, period: { from?: string; to?: string } = {}) {
  const seller = await oneSeller(db, id);
  const statement = await sellerStatement(id, period);
  return { seller, statement };
}

const ROLE_WORD: Record<string, string> = {
  CUSTOMER: 'customer',
  RIDER: 'rider',
  SELLER: 'seller',
  ADMIN: 'staff',
  OPERATIONS: 'staff',
  PACKING_STAFF: 'staff',
};

/** One number = one account: 409 PHONE_IN_USE (with the account's role) when another user has it. */
async function assertPhoneFree(trx: Trx, phone: string, exceptUserId: string | null = null) {
  let q = trx.selectFrom('users').select(['id', 'role']).where('phone', '=', phone);
  if (exceptUserId) q = q.where('id', '!=', exceptUserId);
  const other = await q.executeTakeFirst();
  if (other) {
    const kind = ROLE_WORD[other.role] ?? 'other';
    throw new AppError(`This number already has a Blynk account (${kind}).`, 409, 'PHONE_IN_USE', { role: other.role, field: 'phone' });
  }
}

/**
 * POST /admin/sellers - sellers are invite-only (owner, 2026-10-24). A SELLER user with the phone
 * the seller will sign in with (SMS code on the seller site; no password, no email) plus the
 * sellers row, APPROVED unless staff chose PENDING. No SMS is sent: staff tell the seller.
 * Audited SELLER_CREATED.
 */
export async function createSeller(input: CreateSellerInput, actor: AuditActor) {
  const commission = await commissionContext();
  // Before migration 057 every seller needs a rate of their own: none given = 0 (the old default).
  const pct = input.commission_percent === undefined || input.commission_percent === null ? (commission.ready ? null : 0) : input.commission_percent;
  // Approved straight away = the free month starts now (migration 065; null when none or not run yet).
  const freeUntil = input.status === 'APPROVED' ? await freeUntilForApproval() : null;
  try {
    const seller = await db.transaction().execute(async (trx) => {
      await assertPhoneFree(trx, input.phone);
      const user = await trx
        .insertInto('users')
        .values({ phone: input.phone, phone_hash: phoneHash(input.phone), role: 'SELLER', is_active: true })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      const created = await trx
        .insertInto('sellers')
        .values({
          user_id: user.id,
          shop_name: input.shop_name,
          contact_name: input.contact_name ?? null,
          address: input.address ?? null,
          note: input.note ?? null,
          commission_percent: pct,
          status: input.status,
          ...(input.status === 'APPROVED' ? { reviewed_by: actor.actorId, reviewed_at: sql`now()` } : {}),
          ...(freeUntil ? { commission_free_until: freeUntil } : {}),
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();
      await writeAudit(trx, actor, {
        action: 'SELLER_CREATED',
        entityType: 'SELLER',
        entityId: created.id,
        newValues: {
          seller_id: created.id,
          user_id: user.id,
          shop_name: input.shop_name,
          phone: input.phone,
          status: input.status,
          commission_percent: pct,
          ...(freeUntil ? { commission_free_until: freeUntil.toISOString() } : {}),
        },
      });
      return oneSeller(trx, created.id);
    });
    logger.info({ sellerId: seller.id, by: actor.actorId }, 'Seller added by staff');
    return { seller };
  } catch (err) {
    // Two adds of one number at once meet at the users.phone unique key.
    if ((err as { code?: string }).code === '23505') {
      throw new AppError('This number already has a Blynk account.', 409, 'PHONE_IN_USE', { field: 'phone' });
    }
    throw err;
  }
}

export async function updateSeller(id: string, input: PatchSellerInput, actor: AuditActor) {
  const out = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('sellers').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!current) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');

    const set: Record<string, unknown> = {};
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    let statusChanged = false;

    if (input.status !== undefined && input.status !== current.status) {
      if (input.status === 'REJECTED' && current.status !== 'PENDING') {
        throw new AppError('Only a seller who is waiting for approval can be rejected. Suspend an approved seller instead.', 409, 'SELLER_STATUS_INVALID', {
          status: current.status,
        });
      }
      if (input.status === 'SUSPENDED' && current.status !== 'APPROVED') {
        throw new AppError('Only an approved seller can be suspended.', 409, 'SELLER_STATUS_INVALID', { status: current.status });
      }
      statusChanged = true;
      set.status = input.status;
      set.reviewed_by = actor.actorId;
      set.reviewed_at = sql`now()`;
      // The reason travels with REJECTED (and an optional one with SUSPENDED); approving clears it.
      set.rejection_reason = input.status === 'APPROVED' ? null : input.rejection_reason ?? null;
      oldValues.status = current.status;
      oldValues.rejection_reason = current.rejection_reason;
      newValues.status = input.status;
      newValues.rejection_reason = set.rejection_reason;
    } else if (input.rejection_reason !== undefined && (input.status ?? current.status) === current.status && current.status === 'REJECTED') {
      // Rewording the reason of an already rejected seller.
      set.rejection_reason = input.rejection_reason;
      oldValues.rejection_reason = current.rejection_reason;
      newValues.rejection_reason = input.rejection_reason;
    }

    const currentPct = current.commission_percent === null ? null : Number(current.commission_percent);
    if (input.commission_percent !== undefined && input.commission_percent !== currentPct) {
      // "No own rate" only exists once migration 057 has run (the column was NOT NULL before).
      if (input.commission_percent === null && !(await hasSellerRequestTables())) throw requestsNotReady();
      set.commission_percent = input.commission_percent;
      oldValues.commission_percent = currentPct;
      newValues.commission_percent = input.commission_percent;
    }

    // The commission-free month (migration 065): approving a seller who has no date starts it now;
    // staff can also set / clear it per seller (an explicit date wins over the approval's default).
    const freeColumn = await hasCommissionFreeColumn();
    const currentFree = freeColumn && current.commission_free_until ? new Date(current.commission_free_until) : null;
    if (input.commission_free_until !== undefined) {
      if (!freeColumn) throw freePeriodNotReady();
      const next = input.commission_free_until === null ? null : new Date(input.commission_free_until);
      if ((next?.getTime() ?? null) !== (currentFree?.getTime() ?? null)) {
        set.commission_free_until = next;
        oldValues.commission_free_until = currentFree ? currentFree.toISOString() : null;
        newValues.commission_free_until = next ? next.toISOString() : null;
      }
    } else if (statusChanged && input.status === 'APPROVED' && freeColumn && currentFree === null) {
      const until = await freeUntilForApproval(trx);
      if (until) {
        set.commission_free_until = until;
        oldValues.commission_free_until = null;
        newValues.commission_free_until = until.toISOString();
      }
    }

    // Profile fields staff keep for invite-only sellers (2026-10-24).
    for (const key of ['shop_name', 'contact_name', 'address', 'note'] as const) {
      const next = input[key];
      if (next !== undefined && next !== current[key]) {
        set[key] = next;
        oldValues[key] = current[key];
        newValues[key] = next;
      }
    }

    // The sign-in phone: one number = one account.
    let phoneChanged = false;
    if (input.phone !== undefined) {
      const owner = await trx.selectFrom('users').select(['id', 'phone']).where('id', '=', current.user_id).forUpdate().executeTakeFirstOrThrow();
      if (input.phone !== owner.phone) {
        await assertPhoneFree(trx, input.phone, owner.id);
        await trx.updateTable('users').set({ phone: input.phone, phone_hash: phoneHash(input.phone), updated_at: new Date() }).where('id', '=', owner.id).execute();
        oldValues.phone = publicPhone(owner.phone);
        newValues.phone = input.phone;
        phoneChanged = true;
      }
    }

    let switchedOff = 0;
    if (Object.keys(set).length > 0 || phoneChanged) {
      await trx
        .updateTable('sellers')
        .set({ ...(set as object), updated_at: sql`now()` })
        .where('id', '=', id)
        .execute();

      if (statusChanged && input.status === 'SUSPENDED') {
        // A suspended seller sells nothing: their live products go off (re-approving does not undo it).
        const off = await trx
          .updateTable('products')
          .set({ is_active: false, updated_at: new Date() })
          .where('seller_id', '=', id)
          .where('deleted_at', 'is', null)
          .where('is_active', '=', true)
          .returning('id')
          .execute();
        switchedOff = off.length;
        newValues.products_switched_off = switchedOff;
      }

      await writeAudit(trx, actor, {
        action: 'SELLER_UPDATED',
        entityType: 'SELLER',
        entityId: id,
        oldValues,
        newValues: { ...newValues, shop_name: current.shop_name },
      });
    }

    const user = await trx.selectFrom('users').select(['id', 'phone']).where('id', '=', current.user_id).executeTakeFirstOrThrow();
    return { seller: await oneSeller(trx, id), user, statusChanged, switchedOff, reviewedAt: new Date() };
  });

  if (out.switchedOff > 0) notifyCatalogChanged('products');
  const at = out.reviewedAt.getTime();
  if (out.statusChanged && input.status === 'APPROVED') {
    await notifySeller(out.user, 'SELLER_APPROVED', sellerApprovedPush(), `seller-approved:${id}:${at}`);
  } else if (out.statusChanged && input.status === 'REJECTED') {
    await notifySeller(
      out.user,
      'SELLER_REJECTED',
      sellerRejectedPush(input.rejection_reason ?? ''),
      `seller-rejected:${id}:${at}`
    );
  }
  logger.info({ sellerId: id, by: actor.actorId, status: input.status }, 'Seller updated by staff');
  return { seller: out.seller };
}

// ----------------------------------------------------------------------------
// Shop location (migration 053; seller.location.ts)
// ----------------------------------------------------------------------------

/** The seller's waiting row, locked; 503 before migration 053, 404 / 409 when there is nothing to review. */
async function lockPendingLocation(trx: Trx, id: string) {
  if (!(await hasSellerLocationColumns())) throw locationNotReady();
  const current = await trx.selectFrom('sellers').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
  if (!current) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');
  if (current.location_status !== 'PENDING' || current.pending_latitude === null || current.pending_longitude === null) {
    throw new AppError('This seller has no shop location waiting for review.', 409, 'LOCATION_NOT_PENDING', {
      location_status: current.location_status,
    });
  }
  return current;
}

const coordOf = (v: string | number | null) => (v === null ? null : Number(v));

/** The waiting pin becomes the one in use (riders collect there; delivery is measured from it). */
export async function approveLocation(id: string, actor: AuditActor) {
  const seller = await db.transaction().execute(async (trx) => {
    const current = await lockPendingLocation(trx, id);
    await trx
      .updateTable('sellers')
      .set({
        latitude: current.pending_latitude,
        longitude: current.pending_longitude,
        location_note: current.pending_location_note,
        pending_latitude: null,
        pending_longitude: null,
        pending_location_note: null,
        location_status: 'APPROVED',
        location_reject_reason: null,
        location_reviewed_by: actor.actorId,
        location_reviewed_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, actor, {
      action: 'SELLER_LOCATION_APPROVED',
      entityType: 'SELLER',
      entityId: id,
      oldValues: {
        latitude: coordOf(current.latitude),
        longitude: coordOf(current.longitude),
        location_note: current.location_note,
      },
      newValues: {
        latitude: coordOf(current.pending_latitude),
        longitude: coordOf(current.pending_longitude),
        location_note: current.pending_location_note,
        shop_name: current.shop_name,
      },
    });
    return oneSeller(trx, id);
  });
  logger.info({ sellerId: id, by: actor.actorId }, 'Seller shop location approved');
  return { seller };
}

/** The waiting pin is refused; it stays visible (with the reason) and the approved one, if any, stays in use. */
export async function rejectLocation(id: string, reason: string, actor: AuditActor) {
  const seller = await db.transaction().execute(async (trx) => {
    const current = await lockPendingLocation(trx, id);
    await trx
      .updateTable('sellers')
      .set({
        location_status: 'REJECTED',
        location_reject_reason: reason,
        location_reviewed_by: actor.actorId,
        location_reviewed_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .execute();
    await writeAudit(trx, actor, {
      action: 'SELLER_LOCATION_REJECTED',
      entityType: 'SELLER',
      entityId: id,
      oldValues: { location_status: 'PENDING' },
      newValues: {
        location_status: 'REJECTED',
        reason,
        pending_latitude: coordOf(current.pending_latitude),
        pending_longitude: coordOf(current.pending_longitude),
        shop_name: current.shop_name,
      },
    });
    return oneSeller(trx, id);
  });
  logger.info({ sellerId: id, by: actor.actorId }, 'Seller shop location rejected');
  return { seller };
}

// ----------------------------------------------------------------------------
// Submissions
// ----------------------------------------------------------------------------

export async function listSubmissions(query: ListSubmissionsQuery) {
  const where: ReturnType<typeof sql>[] = [];
  if (query.status !== 'ALL') where.push(sql`x.status = ${query.status}`);
  if (query.seller_id) where.push(sql`x.seller_id = ${query.seller_id}`);
  const cond = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;

  type Row = SubmissionRow & {
    s_id: string;
    s_shop_name: string;
    s_phone: string;
    s_email: string | null;
    s_status: string;
    p_id: string | null;
    p_name: string | null;
    p_selling_price: string | null;
    p_purchase_cost: string | null;
    p_category_id: string | null;
    p_unit: string | null;
    p_pack_size: string | null;
    p_description: string | null;
    p_image_url: string | null;
    p_barcode: string | null;
    p_is_active: boolean | null;
    category_name: string | null;
  };
  const rows = (
    await sql<Row>`
      SELECT x.id, x.seller_id, x.product_id, x.kind, x.status, x.payload, x.seller_price::text AS seller_price,
             x.approved_selling_price::text AS approved_selling_price, x.reject_reason, x.created_at, x.reviewed_at,
             s.id AS s_id, s.shop_name AS s_shop_name, u.phone AS s_phone, u.email AS s_email, s.status AS s_status,
             p.id AS p_id, p.name AS p_name, vp.calculated_selling_price::text AS p_selling_price,
             p.purchase_cost::text AS p_purchase_cost, p.category_id AS p_category_id, p.unit AS p_unit,
             p.pack_size AS p_pack_size, p.description AS p_description, p.image_url AS p_image_url,
             p.barcode AS p_barcode, p.is_active AS p_is_active,
             -- the category the seller chose (the live product's own while no category was proposed)
             (SELECT c.name FROM categories c
               WHERE c.id = COALESCE(
                 CASE WHEN x.payload->>'category_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                      THEN (x.payload->>'category_id')::uuid END,
                 p.category_id)) AS category_name
        FROM seller_submissions x
        JOIN sellers s ON s.id = x.seller_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN products p ON p.id = x.product_id AND p.deleted_at IS NULL
        LEFT JOIN v_product_catalog vp ON vp.id = p.id
        ${cond}
       ORDER BY x.created_at ASC, x.id ASC`.execute(db)
  ).rows;

  return {
    submissions: rows.map((r) => ({
      ...presentSubmission(r),
      seller: { id: r.s_id, shop_name: r.s_shop_name, phone: publicPhone(r.s_phone), email: r.s_email, status: r.s_status },
      product: r.p_id
        ? {
            id: r.p_id,
            name: r.p_name,
            selling_price: r.p_selling_price === null ? null : Number(r.p_selling_price),
            purchase_cost: Number(r.p_purchase_cost),
            // what an EDIT would change (the live values next to the proposed payload)
            category_id: r.p_category_id,
            unit: r.p_unit,
            pack_size: r.p_pack_size,
            description: r.p_description,
            image_url: r.p_image_url,
            barcode: r.p_barcode,
            is_active: r.p_is_active,
          }
        : null,
      category_name: r.category_name,
    })),
  };
}

/** A free SKU for a seller product: "SLR-" + 6 base36 characters, checked against products and variants. */
export async function freeSku(trx: Trx): Promise<string> {
  for (;;) {
    const sku = `SLR-${randomSlugSuffix().toUpperCase()}`;
    const hit =
      (await trx.selectFrom('products').select('id').where('sku', '=', sku).where('deleted_at', 'is', null).executeTakeFirst()) ??
      (await trx.selectFrom('product_variants').select('id').where('sku', '=', sku).where('deleted_at', 'is', null).executeTakeFirst());
    if (!hit) return sku;
  }
}

export async function liveCategory(trx: Trx, id: string) {
  const c = await trx.selectFrom('categories').select(['id', 'name']).where('id', '=', id).where('deleted_at', 'is', null).executeTakeFirst();
  if (!c) throw new AppError('Specified category does not exist.', 400, 'CATEGORY_NOT_FOUND', { field: 'category_id' });
  return c;
}

const sellingPriceRequired = (why: string) =>
  new AppError(why, 400, 'SELLING_PRICE_REQUIRED', { field: 'selling_price' });

export async function approveSubmission(id: string, input: ApproveSubmissionInput, actor: AuditActor) {
  const out = await db.transaction().execute(async (trx) => {
    const sub = await trx.selectFrom('seller_submissions').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!sub) throw new AppError('Submission not found.', 404, 'SUBMISSION_NOT_FOUND');
    if (sub.status !== 'PENDING') {
      throw new AppError('This submission has already been reviewed or withdrawn.', 409, 'SUBMISSION_NOT_PENDING', { status: sub.status });
    }
    const seller = await trx.selectFrom('sellers').selectAll().where('id', '=', sub.seller_id).forUpdate().executeTakeFirstOrThrow();
    if (seller.status !== 'APPROVED') {
      throw new AppError('Approve the seller before approving their products.', 409, 'SELLER_NOT_APPROVED', { status: seller.status });
    }
    const user = await trx.selectFrom('users').select(['id', 'phone']).where('id', '=', seller.user_id).executeTakeFirstOrThrow();
    const parsed = submissionPayloadSchema.safeParse(sub.payload);
    if (!parsed.success) throw new AppError('The seller\'s product details are incomplete.', 409, 'SUBMISSION_INVALID');
    const payload: SubmissionPayload = parsed.data;
    const sellerPrice = Number(sub.seller_price);
    const categoryId = input.category_id ?? payload.category_id;

    let productId: string;
    let productName: string;
    let approvedPrice: number;

    if (sub.kind === 'NEW') {
      if (input.selling_price === undefined) throw sellingPriceRequired('Set the selling price to approve a new product.');
      if (!payload.name || !payload.unit || !categoryId) {
        throw new AppError('The seller\'s product details are incomplete.', 409, 'SUBMISSION_INVALID');
      }
      await liveCategory(trx, categoryId);
      const slug = await generateUniqueSlug(
        payload.name,
        'product',
        async (s) => !!(await trx.selectFrom('products').select('id').where('slug', '=', s).where('deleted_at', 'is', null).executeTakeFirst()),
        255
      );
      const created = await catalogRepository.createProduct(
        {
          category_id: categoryId,
          name: payload.name,
          slug,
          sku: await freeSku(trx),
          barcode: payload.barcode ?? null,
          unit: payload.unit,
          pack_size: payload.pack_size ?? null,
          description: payload.description ?? null,
          image_url: payload.image_url ?? null,
          purchase_cost: sellerPrice,
          pricing_mode: 'FIXED',
          fixed_selling_price: input.selling_price,
          is_available: true,
          is_active: true,
          seller_id: seller.id,
        },
        trx
      );
      // Blynk holds the stock: tracked at 0 until staff receive the seller's goods in Inventory.
      await trx
        .insertInto('inventory')
        .values({ dark_store_id: DEFAULT_DARK_STORE_ID, product_id: created.id, tracking_mode: 'TRACKED' })
        .execute();
      productId = created.id;
      productName = created.name;
      approvedPrice = input.selling_price;
    } else {
      if (!sub.product_id) throw new AppError('The product this edit is for no longer exists.', 409, 'PRODUCT_NOT_FOUND');
      const product = await trx
        .selectFrom('products')
        .selectAll()
        .where('id', '=', sub.product_id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!product || product.seller_id !== seller.id) {
        throw new AppError('The product this edit is for no longer exists.', 409, 'PRODUCT_NOT_FOUND');
      }
      if (categoryId && categoryId !== product.category_id) await liveCategory(trx, categoryId);

      const priceChanged = Math.round(sellerPrice * 100) !== Math.round(Number(product.purchase_cost) * 100);
      if (priceChanged && input.selling_price === undefined) {
        throw sellingPriceRequired("The seller changed their price: set the selling price to approve this edit.");
      }
      const patch: Parameters<typeof catalogRepository.updateProduct>[1] = {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(categoryId !== undefined ? { category_id: categoryId } : {}),
        ...(payload.unit !== undefined ? { unit: payload.unit } : {}),
        ...(payload.pack_size !== undefined ? { pack_size: payload.pack_size } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.image_url !== undefined ? { image_url: payload.image_url } : {}),
        ...(payload.barcode !== undefined ? { barcode: payload.barcode } : {}),
      };
      if (priceChanged || input.selling_price !== undefined) {
        const selling = input.selling_price ?? Number(product.fixed_selling_price);
        patch.purchase_cost = sellerPrice;
        patch.pricing_mode = 'FIXED';
        patch.fixed_selling_price = selling;
        // A running offer must stay below the new price (the same rule Admin's edit applies).
        const offerRunning =
          product.offer_price !== null && (product.offer_ends_at === null || new Date(product.offer_ends_at).getTime() > Date.now());
        if (offerRunning) {
          const price = await priceForProduct(
            {
              categoryId: categoryId ?? product.category_id,
              purchaseCost: sellerPrice,
              pricingMode: 'FIXED',
              fixedSellingPrice: selling,
              customMarkupPercent: null,
              mrp: product.mrp === null ? null : Number(product.mrp),
            },
            trx
          );
          assertOfferAllowed({
            offerPrice: Number(product.offer_price),
            sellingPrice: price.sellingPrice,
            endsAt: null,
            endsAtChanged: false,
            mrpCapped: price.mrpCapped,
          });
        }
        approvedPrice = selling;
      } else {
        const live = await trx.selectFrom('v_product_catalog').select('calculated_selling_price').where('id', '=', product.id).executeTakeFirst();
        approvedPrice = round2(Number(live?.calculated_selling_price ?? 0));
      }
      const updated = await catalogRepository.updateProduct(product.id, patch, trx);
      if (!updated) throw new AppError('The product this edit is for no longer exists.', 409, 'PRODUCT_NOT_FOUND');
      productId = updated.id;
      productName = updated.name;
    }

    const [row] = await trx
      .updateTable('seller_submissions')
      .set({
        status: 'APPROVED',
        product_id: productId,
        approved_selling_price: approvedPrice,
        reject_reason: null,
        reviewed_by: actor.actorId,
        reviewed_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where('id', '=', id)
      .returningAll()
      .execute();
    await writeAudit(trx, actor, {
      action: 'SELLER_SUBMISSION_APPROVED',
      entityType: 'SELLER_SUBMISSION',
      entityId: id,
      oldValues: { status: 'PENDING' },
      newValues: {
        kind: sub.kind,
        seller_id: seller.id,
        product_id: productId,
        seller_price: sellerPrice,
        selling_price: approvedPrice,
      },
    });
    return { submission: presentSubmission(row as unknown as SubmissionRow), productId, productName, user, sellerId: seller.id };
  });

  notifyCatalogChanged('products');
  await notifySeller(out.user, 'SELLER_PRODUCT_APPROVED', productApprovedPush(out.productName), `seller-product-approved:${id}`);
  logger.info({ submissionId: id, productId: out.productId, by: actor.actorId }, 'Seller submission approved');
  const product = await catalogService.getProductByIdAdmin(out.productId);
  return { submission: out.submission, product: { ...product, seller_id: out.sellerId } };
}

export async function rejectSubmission(id: string, reason: string, actor: AuditActor) {
  const out = await db.transaction().execute(async (trx) => {
    const sub = await trx.selectFrom('seller_submissions').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
    if (!sub) throw new AppError('Submission not found.', 404, 'SUBMISSION_NOT_FOUND');
    if (sub.status !== 'PENDING') {
      throw new AppError('This submission has already been reviewed or withdrawn.', 409, 'SUBMISSION_NOT_PENDING', { status: sub.status });
    }
    const seller = await trx.selectFrom('sellers').select(['id', 'user_id']).where('id', '=', sub.seller_id).executeTakeFirstOrThrow();
    const user = await trx.selectFrom('users').select(['id', 'phone']).where('id', '=', seller.user_id).executeTakeFirstOrThrow();
    const [row] = await trx
      .updateTable('seller_submissions')
      .set({ status: 'REJECTED', reject_reason: reason, reviewed_by: actor.actorId, reviewed_at: sql`now()`, updated_at: sql`now()` })
      .where('id', '=', id)
      .returningAll()
      .execute();
    await writeAudit(trx, actor, {
      action: 'SELLER_SUBMISSION_REJECTED',
      entityType: 'SELLER_SUBMISSION',
      entityId: id,
      oldValues: { status: 'PENDING' },
      newValues: { kind: sub.kind, seller_id: seller.id, product_id: sub.product_id, reason },
    });
    const parsed = submissionPayloadSchema.safeParse(sub.payload);
    let name = parsed.success ? parsed.data.name : undefined;
    if (!name && sub.product_id) {
      name = (await trx.selectFrom('products').select('name').where('id', '=', sub.product_id).executeTakeFirst())?.name;
    }
    return { submission: presentSubmission(row as unknown as SubmissionRow), user, name: name ?? 'Your product' };
  });
  await notifySeller(out.user, 'SELLER_PRODUCT_REJECTED', productRejectedPush(out.name, reason), `seller-product-rejected:${id}`);
  logger.info({ submissionId: id, by: actor.actorId }, 'Seller submission rejected');
  return { submission: out.submission };
}

// ----------------------------------------------------------------------------
// Payouts (a manual ledger: money Blynk has paid the seller)
// ----------------------------------------------------------------------------

/** Today in Colombo as YYYY-MM-DD (the DB's CURRENT_DATE follows the server's zone). */
const colomboToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * One ledger entry with its SELLER_PAYOUT_RECORDED audit row, inside the caller's transaction
 * (POST /admin/sellers/:id/payouts, and paying a seller's payout request in seller-requests.service.ts).
 * Locks the seller row; 404 SELLER_NOT_FOUND.
 */
export async function insertPayout(
  trx: Trx,
  sellerId: string,
  input: { amount: number; note: string | null; paid_on?: string },
  actor: AuditActor,
  extraAudit: Record<string, unknown> = {}
) {
  const seller = await trx.selectFrom('sellers').select(['id', 'shop_name']).where('id', '=', sellerId).forUpdate().executeTakeFirst();
  if (!seller) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');
  const paidOn = input.paid_on ?? colomboToday();
  const [row] = await trx
    .insertInto('seller_payouts')
    .values({ seller_id: sellerId, amount: input.amount, note: input.note, paid_on: paidOn, created_by: actor.actorId })
    .returning(['id', 'amount', 'note', sql<string>`to_char(paid_on, 'YYYY-MM-DD')`.as('paid_on')])
    .execute();
  await writeAudit(trx, actor, {
    action: 'SELLER_PAYOUT_RECORDED',
    entityType: 'SELLER',
    entityId: sellerId,
    newValues: { payout_id: row!.id, amount: input.amount, note: input.note, paid_on: paidOn, shop_name: seller.shop_name, ...extraAudit },
  });
  return { id: row!.id, amount: round2(Number(row!.amount)), note: row!.note, paid_on: row!.paid_on as unknown as string };
}

export async function recordPayout(sellerId: string, input: RecordPayoutInput, actor: AuditActor) {
  const payout = await db.transaction().execute((trx) => insertPayout(trx, sellerId, input, actor));
  logger.info({ sellerId, payoutId: payout.id, by: actor.actorId }, 'Seller payout recorded');
  return { payout, statement: await sellerStatement(sellerId) };
}

export async function deletePayout(sellerId: string, payoutId: string, actor: AuditActor) {
  await db.transaction().execute(async (trx) => {
    const row = await trx
      .selectFrom('seller_payouts')
      .select(['id', 'amount', 'note', sql<string>`to_char(paid_on, 'YYYY-MM-DD')`.as('paid_on')])
      .where('id', '=', payoutId)
      .where('seller_id', '=', sellerId)
      .forUpdate()
      .executeTakeFirst();
    if (!row) throw new AppError('Payout not found.', 404, 'PAYOUT_NOT_FOUND');
    await trx.deleteFrom('seller_payouts').where('id', '=', payoutId).execute();
    await writeAudit(trx, actor, {
      action: 'SELLER_PAYOUT_DELETED',
      entityType: 'SELLER',
      entityId: sellerId,
      oldValues: { payout_id: row.id, amount: round2(Number(row.amount)), note: row.note, paid_on: row.paid_on },
    });
  });
  logger.info({ sellerId, payoutId, by: actor.actorId }, 'Seller payout deleted');
  return { statement: await sellerStatement(sellerId) };
}
