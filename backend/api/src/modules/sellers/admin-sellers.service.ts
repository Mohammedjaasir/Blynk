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
import { notificationService } from '../notifications/notification.service.js';
import { sellerStatement } from './seller.statement.js';
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
 * Every change is one transaction with its audit row; the SMS to the seller is queued after the
 * commit and a failure there never fails the request.
 *
 * Rules worth knowing:
 *   - A seller is REJECTED only while PENDING, SUSPENDED only while APPROVED; re-approving a
 *     suspended seller does NOT switch their products back on (staff do that per product).
 *   - A submission can only be approved while its seller is APPROVED.
 *   - A NEW approval creates the product like Admin's create does (slug and SKU generated), at a
 *     FIXED customer price, purchase_cost = the seller's price, seller_id set, and a TRACKED
 *     inventory row at 0 - Blynk holds the stock, so the product shows as sold out until staff
 *     receive the seller's goods in Inventory.
 *   - An EDIT applies the proposed fields to the live product (slug and SKU never change). The
 *     price only changes when the seller's price did (then the selling price is required) or when
 *     staff send one.
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
/** Where sellers sign in (owner, 2026-10-24); SELLER_APP_URL overrides it. */
const SHOP_URL = process.env.SELLER_APP_URL?.trim() || 'https://blynk-seller.valgrowlabs.com';
const SMS_REASON_MAX = 120;

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
  commission_percent: string;
  created_at: Date;
  user_id: string;
  phone: string;
  email: string | null;
  full_name: string | null;
  products_live: number;
  submissions_pending: number;
  gross: string;
  paid: string;
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
  const pct = Number(r.commission_percent);
  const gross = round2(Number(r.gross));
  const earned = round2(gross - round2((gross * pct) / 100));
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
    due: round2(earned - round2(Number(r.paid))),
    // the shop pin: approved (used for delivery) and waiting (seller.location.ts)
    ...presentLocation(r as unknown as Record<string, unknown>, ctx),
  };
}

/** AdminSeller rows (one query for any number of sellers; `due` follows seller.statement's rules). */
async function sellerRows(executor: typeof db | Trx, where: ReturnType<typeof sql>[], located: boolean): Promise<SellerRow[]> {
  const cond = where.length ? sql`WHERE ${sql.join(where, sql` AND `)}` : sql``;
  const r = await sql<SellerRow>`
    SELECT s.id, s.shop_name, s.contact_name, s.address, s.note, s.status, s.rejection_reason,
           s.commission_percent::text AS commission_percent, s.created_at, s.user_id, u.phone, u.email, u.full_name,
           ${locationSelect(located)},
           (SELECT count(*)::int FROM products p WHERE p.seller_id = s.id AND p.deleted_at IS NULL AND p.is_active) AS products_live,
           (SELECT count(*)::int FROM seller_submissions x WHERE x.seller_id = s.id AND x.status = 'PENDING') AS submissions_pending,
           (SELECT COALESCE(SUM(oi.quantity * oi.estimated_unit_cost), 0)::text
              FROM order_items oi
              JOIN orders o ON o.id = oi.order_id
              JOIN products p ON p.id = oi.product_id
             WHERE p.seller_id = s.id AND o.order_status = 'DELIVERED'
               AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')) AS gross,
           (SELECT COALESCE(SUM(amount), 0)::text FROM seller_payouts WHERE seller_id = s.id) AS paid
      FROM sellers s
      JOIN users u ON u.id = s.user_id
      ${cond}
     ORDER BY (s.status = 'PENDING') DESC, s.created_at DESC`.execute(executor);
  return r.rows;
}

async function oneSeller(executor: typeof db | Trx, id: string) {
  const ctx = await locationContext();
  const [row] = await sellerRows(executor, [sql`s.id = ${id}`], ctx.columns);
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
// SMS to the seller (after the commit; never fails the request)
// ----------------------------------------------------------------------------

const smsReason = (reason: string) =>
  reason.length > SMS_REASON_MAX ? `${reason.slice(0, SMS_REASON_MAX - 3).trimEnd()}...` : reason;
const smsName = (name: string) => (name.length > 50 ? `${name.slice(0, 47).trimEnd()}...` : name);

export const SELLER_APPROVED_SMS = `Blynk: your seller account is approved. You can add products now: ${SHOP_URL}`;
export const sellerRejectedSms = (reason: string) => `Blynk: your seller application wasn't approved. Reason: ${smsReason(reason)}`;
export const productApprovedSms = (name: string) => `Blynk: ${smsName(name)} is live.`;
export const productRejectedSms = (name: string, reason: string) => `Blynk: ${smsName(name)} was not approved: ${smsReason(reason)}`;

async function textSeller(
  user: { id: string; phone: string },
  type: 'SELLER_APPROVED' | 'SELLER_REJECTED' | 'SELLER_PRODUCT_APPROVED' | 'SELLER_PRODUCT_REJECTED',
  text: string,
  key: string
) {
  // A seller who signed up with an email has no phone: nothing to text (they
  // see the change when they next open the seller site).
  const phone = publicPhone(user.phone);
  if (!phone) {
    logger.info({ type, userId: user.id }, 'Seller SMS skipped: the seller has no phone number');
    return;
  }
  try {
    await notificationService.enqueue({
      user_id: user.id,
      channel: 'SMS',
      notification_type: type,
      recipient: phone,
      idempotency_key: key,
      payload: { text },
    });
  } catch (err) {
    logger.warn({ err, type }, 'Seller SMS could not be queued');
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
  const ctx = await locationContext();
  return { sellers: (await sellerRows(db, where, ctx.columns)).map((r) => presentSeller(r, ctx)) };
}

export async function getSeller(id: string, period: { from?: string; to?: string } = {}) {
  const seller = await oneSeller(db, id);
  const statement = await sellerStatement(id, period);
  return { seller, statement };
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

    if (input.commission_percent !== undefined && input.commission_percent !== Number(current.commission_percent)) {
      set.commission_percent = input.commission_percent;
      oldValues.commission_percent = Number(current.commission_percent);
      newValues.commission_percent = input.commission_percent;
    }

    let switchedOff = 0;
    if (Object.keys(set).length > 0) {
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
    await textSeller(out.user, 'SELLER_APPROVED', SELLER_APPROVED_SMS, `seller-approved:${id}:${at}`);
  } else if (out.statusChanged && input.status === 'REJECTED') {
    await textSeller(
      out.user,
      'SELLER_REJECTED',
      sellerRejectedSms(input.rejection_reason ?? ''),
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
async function freeSku(trx: Trx): Promise<string> {
  for (;;) {
    const sku = `SLR-${randomSlugSuffix().toUpperCase()}`;
    const hit =
      (await trx.selectFrom('products').select('id').where('sku', '=', sku).where('deleted_at', 'is', null).executeTakeFirst()) ??
      (await trx.selectFrom('product_variants').select('id').where('sku', '=', sku).where('deleted_at', 'is', null).executeTakeFirst());
    if (!hit) return sku;
  }
}

async function liveCategory(trx: Trx, id: string) {
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
  await textSeller(out.user, 'SELLER_PRODUCT_APPROVED', productApprovedSms(out.productName), `seller-product-approved:${id}`);
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
  await textSeller(out.user, 'SELLER_PRODUCT_REJECTED', productRejectedSms(out.name, reason), `seller-product-rejected:${id}`);
  logger.info({ submissionId: id, by: actor.actorId }, 'Seller submission rejected');
  return { submission: out.submission };
}

// ----------------------------------------------------------------------------
// Payouts (a manual ledger: money Blynk has paid the seller)
// ----------------------------------------------------------------------------

/** Today in Colombo as YYYY-MM-DD (the DB's CURRENT_DATE follows the server's zone). */
const colomboToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function recordPayout(sellerId: string, input: RecordPayoutInput, actor: AuditActor) {
  const payout = await db.transaction().execute(async (trx) => {
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
      newValues: { payout_id: row!.id, amount: input.amount, note: input.note, paid_on: paidOn, shop_name: seller.shop_name },
    });
    return { id: row!.id, amount: round2(Number(row!.amount)), note: row!.note, paid_on: row!.paid_on as unknown as string };
  });
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
