import { sql } from 'kysely';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { catalogRepository } from '../catalog/catalog.repository.js';
import { notifyCatalogChanged } from '../catalog/catalog.events.js';
import { generateUniqueSlug } from '../catalog/catalog.slugs.js';
import { DEFAULT_DARK_STORE_ID } from '../inventory/inventory.service.js';
import { lockInventoryRow, recordStockMovement } from '../inventory/stock-ledger.js';
import type { AdminSellerLocationInput, CreateSellerProductInput } from './admin-sellers.schema.js';
import { freeSku, liveCategory, oneSeller } from './admin-sellers.service.js';
import { hasSellerLocationColumns, locationNotReady } from './seller.location.js';

/**
 * Staff do the seller's work when the seller does not know how (owner's brother, 2026-10-30: "from
 * Admin: create the products and the shop for a seller"). All ADMIN / OPERATIONS:
 *
 *   GET  /admin/sellers/:id/products   what the seller sells (LIVE / PAUSED / OFF)
 *   POST /admin/sellers/:id/products   a LIVE product owned by the seller, photo required
 *   PUT  /admin/sellers/:id/location   the shop pin, approved straight away
 *
 * The shop's name, contact, address and note are PATCH /admin/sellers/:id (admin-sellers.service.ts).
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export type SellerProductStatus = 'LIVE' | 'PAUSED' | 'OFF';

export interface AdminSellerProduct {
  id: string;
  name: string;
  image_url: string | null;
  category_name: string | null;
  /** What the customer pays (the product's selling price, offers aside). */
  selling_price: number | null;
  /** What Blynk pays the seller. */
  seller_price: number;
  is_active: boolean;
  is_available: boolean;
  /** LIVE = active and available, PAUSED = active but unavailable (the seller paused it), OFF = not active. */
  status: SellerProductStatus;
  /** Counted stock; null when the product's stock is not counted. */
  stock_on_hand: number | null;
}

interface ProductListRow {
  id: string;
  name: string;
  image_url: string | null;
  category_name: string | null;
  selling_price: string | null;
  seller_price: string;
  is_active: boolean;
  is_available: boolean;
  stock_on_hand: string | null;
}

const statusOf = (active: boolean, available: boolean): SellerProductStatus => (!active ? 'OFF' : available ? 'LIVE' : 'PAUSED');

/** The seller's products (deleted ones left out), by name; `only` limits it to one product. */
async function sellerProducts(executor: typeof db, sellerId: string, only?: string): Promise<AdminSellerProduct[]> {
  const rows = (
    await sql<ProductListRow>`
      SELECT p.id, p.name, p.image_url, c.name AS category_name, p.is_active, p.is_available,
             p.purchase_cost::text AS seller_price,
             vp.calculated_selling_price::text AS selling_price,
             (SELECT SUM(i.quantity_on_hand)::text FROM inventory i
               WHERE i.product_id = p.id AND i.tracking_mode = 'TRACKED') AS stock_on_hand
        FROM products p
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN v_product_catalog vp ON vp.id = p.id
       WHERE p.seller_id = ${sellerId} AND p.deleted_at IS NULL
         ${only ? sql`AND p.id = ${only}` : sql``}
       ORDER BY p.name ASC, p.id ASC`.execute(executor)
  ).rows;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    image_url: r.image_url,
    category_name: r.category_name,
    selling_price: r.selling_price === null ? null : round2(Number(r.selling_price)),
    seller_price: round2(Number(r.seller_price)),
    is_active: r.is_active,
    is_available: r.is_available,
    status: statusOf(r.is_active, r.is_available),
    stock_on_hand: r.stock_on_hand === null ? null : Number(r.stock_on_hand),
  }));
}

async function assertSellerExists(sellerId: string) {
  const seller = await db.selectFrom('sellers').select('id').where('id', '=', sellerId).executeTakeFirst();
  if (!seller) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');
}

/** GET /admin/sellers/:id/products */
export async function listSellerProducts(sellerId: string) {
  await assertSellerExists(sellerId);
  return { products: await sellerProducts(db, sellerId) };
}

export const imageRequired = () => new AppError('Add a photo of the product.', 400, 'IMAGE_REQUIRED', { field: 'image_url' });

/**
 * POST /admin/sellers/:id/products - creates a LIVE product owned by the seller the way approving a
 * seller's submission does (admin-sellers.service.ts approveSubmission): slug and "SLR-" SKU
 * generated, FIXED customer price = selling_price, purchase_cost = seller_price, active and
 * available, a TRACKED inventory row - with the opening stock booked through the stock ledger
 * (one PURCHASE_RESTOCK row, staff as the actor) when stock_quantity is above 0. 400 IMAGE_REQUIRED
 * without a photo; 409 SELLER_NOT_APPROVED unless the seller is APPROVED. Audited
 * ADMIN_CREATED_SELLER_PRODUCT.
 */
export async function createSellerProduct(sellerId: string, input: CreateSellerProductInput, actor: AuditActor) {
  if (!input.image_url) throw imageRequired();

  const out = await db.transaction().execute(async (trx) => {
    const seller = await trx.selectFrom('sellers').selectAll().where('id', '=', sellerId).forUpdate().executeTakeFirst();
    if (!seller) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');
    if (seller.status !== 'APPROVED') {
      throw new AppError('Approve the seller before adding products for them.', 409, 'SELLER_NOT_APPROVED', { status: seller.status });
    }
    await liveCategory(trx, input.category_id);
    const slug = await generateUniqueSlug(
      input.name,
      'product',
      async (s) => !!(await trx.selectFrom('products').select('id').where('slug', '=', s).where('deleted_at', 'is', null).executeTakeFirst()),
      255
    );
    const created = await catalogRepository.createProduct(
      {
        category_id: input.category_id,
        name: input.name,
        slug,
        sku: await freeSku(trx),
        barcode: input.barcode ?? null,
        unit: input.unit,
        pack_size: input.pack_size ?? null,
        description: input.description ?? null,
        image_url: input.image_url,
        purchase_cost: input.seller_price,
        pricing_mode: 'FIXED',
        fixed_selling_price: input.selling_price,
        is_available: true,
        is_active: true,
        seller_id: seller.id,
      },
      trx
    );
    // Blynk holds the stock: tracked, at 0 unless staff counted what the seller handed over.
    await trx
      .insertInto('inventory')
      .values({ dark_store_id: DEFAULT_DARK_STORE_ID, product_id: created.id, tracking_mode: 'TRACKED' })
      .execute();
    const stock = input.stock_quantity ?? 0;
    if (stock > 0) {
      const inventory = await lockInventoryRow(trx, DEFAULT_DARK_STORE_ID, created.id);
      if (!inventory) throw new AppError('Stock could not be set.', 500, 'INTERNAL_SERVER_ERROR');
      await recordStockMovement(trx, {
        inventory,
        delta: stock,
        type: 'PURCHASE_RESTOCK',
        orderId: null,
        actorId: actor.actorId,
        notes: `Opening stock added by staff for seller ${seller.shop_name}`,
      });
    }
    await writeAudit(trx, actor, {
      action: 'ADMIN_CREATED_SELLER_PRODUCT',
      entityType: 'PRODUCT',
      entityId: created.id,
      newValues: {
        seller_id: seller.id,
        shop_name: seller.shop_name,
        product_name: created.name,
        seller_price: input.seller_price,
        selling_price: input.selling_price,
        stock_quantity: stock,
      },
    });
    return { productId: created.id };
  });

  notifyCatalogChanged('products');
  logger.info({ sellerId, productId: out.productId, by: actor.actorId }, 'Product created by staff for a seller');
  const [product] = await sellerProducts(db, sellerId, out.productId);
  return { product };
}

const coordOf = (v: string | number | null) => (v === null ? null : Number(v));

/**
 * PUT /admin/sellers/:id/location - staff set the shop pin themselves: it is written as the
 * APPROVED point at once (riders collect there, delivery is measured from it), replacing any pin
 * the seller had waiting (that request is cleared). `how_to_find` left out keeps the current note;
 * blank / null clears it. The coordinates must be inside Sri Lanka (the seller's own pin has the
 * same bounds, nothing else). Audited ADMIN_SET_SELLER_LOCATION; 503 LOCATION_NOT_READY before
 * migration 053. Returns { seller } as PATCH does.
 */
export async function setSellerLocation(sellerId: string, input: AdminSellerLocationInput, actor: AuditActor) {
  if (!(await hasSellerLocationColumns())) throw locationNotReady();
  const seller = await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('sellers').selectAll().where('id', '=', sellerId).forUpdate().executeTakeFirst();
    if (!current) throw new AppError('Seller not found.', 404, 'SELLER_NOT_FOUND');
    const note = input.how_to_find !== undefined ? input.how_to_find : current.location_note;
    const hadPending = current.location_status === 'PENDING' || current.pending_latitude !== null;
    await trx
      .updateTable('sellers')
      .set({
        latitude: input.latitude,
        longitude: input.longitude,
        location_note: note,
        pending_latitude: null,
        pending_longitude: null,
        pending_location_note: null,
        location_status: 'APPROVED',
        location_reject_reason: null,
        location_reviewed_by: actor.actorId,
        location_reviewed_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where('id', '=', sellerId)
      .execute();
    await writeAudit(trx, actor, {
      action: 'ADMIN_SET_SELLER_LOCATION',
      entityType: 'SELLER',
      entityId: sellerId,
      oldValues: {
        latitude: coordOf(current.latitude),
        longitude: coordOf(current.longitude),
        location_note: current.location_note,
      },
      newValues: {
        latitude: input.latitude,
        longitude: input.longitude,
        location_note: note,
        cleared_pending_request: hadPending,
        shop_name: current.shop_name,
      },
    });
    return oneSeller(trx, sellerId);
  });
  logger.info({ sellerId, by: actor.actorId }, 'Seller shop location set by staff');
  return { seller };
}
