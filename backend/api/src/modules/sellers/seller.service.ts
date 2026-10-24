import { sql, type Selectable, type Updateable } from 'kysely';
import { db } from '../../database/connection.js';
import type { SellersTable, SellerSubmissionsTable } from '../../database/types.js';
import {
  locationContext,
  locationNotReady,
  presentLocation,
  type LocationContext,
  type SellerLocation,
} from './seller.location.js';
import { AppError } from '../../middleware/error.middleware.js';
import { priceForProduct } from '../catalog/catalog.pricing.js';
import type { CreateProductInput, EditProductInput, ProfileInput } from './seller.schema.js';
import { sellerStatement, type Statement } from './seller.statement.js';
import { commissionRule } from './seller.commission.js';

/**
 * Seller-facing logic (role SELLER; docs/superpowers/plans/2026-10-24-seller-portal.md). A seller
 * never changes a product directly: every new product and every edit is a seller_submissions row
 * that Admin approves (admin-sellers.*), so a live product keeps its values until then. Sellers
 * only ever see their own rows and never any customer or order detail - only units sold and stock.
 */

type SellerRow = Selectable<SellersTable>;
type SubmissionRow = Selectable<SellerSubmissionsTable>;

/** The seller's own row, plus the shop location (seller.location.ts; nulls / NONE before migration 053). */
export interface SellerDto extends SellerLocation {
  id: string;
  shop_name: string;
  contact_name: string | null;
  address: string | null;
  note: string | null;
  status: SellerRow['status'];
  rejection_reason: string | null;
  /** The seller's own rate; null = the category's rate or the default (seller.commission.ts). */
  commission_percent: number | null;
  created_at: Date;
}

/** What a submission proposes (stored as JSON; an EDIT carries the whole product, not just the changes). */
export interface SubmissionPayload {
  name: string;
  category_id: string;
  unit: string;
  pack_size: string | null;
  description: string | null;
  image_url: string | null;
  barcode: string | null;
}

export interface SubmissionDto {
  id: string;
  kind: SubmissionRow['kind'];
  status: SubmissionRow['status'];
  product_id: string | null;
  payload: Record<string, unknown>;
  seller_price: number;
  approved_selling_price: number | null;
  reject_reason: string | null;
  created_at: Date;
  reviewed_at: Date | null;
}

export interface SellerProductDto {
  id: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  unit: string;
  pack_size: string | null;
  description: string | null;
  image_url: string | null;
  barcode: string | null;
  is_active: boolean;
  is_available: boolean;
  seller_price: number;
  selling_price: number | null;
  stock_on_hand: number | null;
  units_sold: number;
  live: boolean;
  pending: SubmissionDto | null;
  last_rejected: SubmissionDto | null;
}

export const toSellerDto = (s: SellerRow, ctx: LocationContext): SellerDto => ({
  id: s.id,
  shop_name: s.shop_name,
  contact_name: s.contact_name,
  address: s.address,
  note: s.note,
  status: s.status,
  rejection_reason: s.rejection_reason,
  commission_percent: s.commission_percent === null ? null : Number(s.commission_percent),
  created_at: s.created_at,
  ...presentLocation(s as unknown as Record<string, unknown>, ctx),
});

const coord = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const samePoint = (a: number | null, b: number | null) => a !== null && b !== null && Math.round(a * 1e6) === Math.round(b * 1e6);

/**
 * What a profile save does to the shop location (migration 053). The seller's pin always waits for
 * Admin: it goes to the pending_* columns and location_status PENDING, and the approved point stays
 * in force until Admin approves it.
 *   - latitude + longitude: a new waiting point (its note: the one sent, else the waiting / approved
 *     one). The approved point sent back unchanged just cancels any waiting change.
 *   - latitude: null + longitude: null: withdraws the waiting change (the approved point stays; only
 *     Admin's approval moves the point delivery uses).
 *   - location_note alone: rewrites the waiting note; with only an approved point, a changed note
 *     waits for Admin like a moved pin; with no point yet it is kept for when the seller pins one.
 */
function locationChange(current: SellerRow, input: ProfileInput): Updateable<SellersTable> {
  const lat = coord(current.latitude);
  const lng = coord(current.longitude);
  const hasApproved = lat !== null && lng !== null;
  const approvedNote = current.location_note ?? null;
  const clearPending = { pending_latitude: null, pending_longitude: null, pending_location_note: null, location_reject_reason: null };

  if (input.latitude != null && input.longitude != null) {
    const note = input.location_note !== undefined ? input.location_note : current.pending_location_note ?? approvedNote;
    if (hasApproved && samePoint(input.latitude, lat) && samePoint(input.longitude, lng) && (note ?? null) === approvedNote) {
      return { ...clearPending, location_status: 'APPROVED' };
    }
    return {
      pending_latitude: input.latitude,
      pending_longitude: input.longitude,
      pending_location_note: note ?? null,
      location_status: 'PENDING',
      location_reject_reason: null,
    };
  }
  if (input.latitude === null) {
    return { ...clearPending, location_status: hasApproved ? 'APPROVED' : 'NONE' };
  }
  if (input.location_note !== undefined) {
    const note = input.location_note ?? null;
    if (current.location_status === 'PENDING') return { pending_location_note: note };
    if (hasApproved) {
      if (note === approvedNote) return {};
      return { pending_latitude: lat, pending_longitude: lng, pending_location_note: note, location_status: 'PENDING', location_reject_reason: null };
    }
    return { pending_location_note: note };
  }
  return {};
}

export const toSubmissionDto = (s: SubmissionRow): SubmissionDto => ({
  id: s.id,
  kind: s.kind,
  status: s.status,
  product_id: s.product_id,
  payload: s.payload,
  seller_price: Number(s.seller_price),
  approved_selling_price: s.approved_selling_price === null ? null : Number(s.approved_selling_price),
  reject_reason: s.reject_reason,
  created_at: s.created_at,
  reviewed_at: s.reviewed_at,
});

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

interface ProductRow {
  id: string;
  category_id: string;
  category_name: string | null;
  name: string;
  unit: string;
  pack_size: string | null;
  description: string | null;
  image_url: string | null;
  barcode: string | null;
  is_active: boolean;
  is_available: boolean;
  purchase_cost: string;
  pricing_mode: 'MARKUP' | 'FIXED';
  fixed_selling_price: string | null;
  custom_markup_percent: string | null;
  mrp: string | null;
  stock_on_hand: string | null;
  units_sold: string;
}

export class SellerService {
  /** The caller's seller row. */
  async sellerOf(userId: string): Promise<SellerRow> {
    const seller = await db.selectFrom('sellers').selectAll().where('user_id', '=', userId).executeTakeFirst();
    if (!seller) throw new AppError('Seller profile not found.', 404, 'SELLER_NOT_FOUND');
    return seller;
  }

  private assertApproved(seller: SellerRow): void {
    if (seller.status !== 'APPROVED') {
      throw new AppError('Your seller account has not been approved yet.', 403, 'SELLER_NOT_APPROVED', { status: seller.status });
    }
  }

  async me(userId: string) {
    const seller = await this.sellerOf(userId);
    const [products, pending, ctx] = await Promise.all([
      db
        .selectFrom('products')
        .select(sql<string>`count(*)`.as('n'))
        .where('seller_id', '=', seller.id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow(),
      db
        .selectFrom('seller_submissions')
        .select(sql<string>`count(*)`.as('n'))
        .where('seller_id', '=', seller.id)
        .where('status', '=', 'PENDING')
        .executeTakeFirstOrThrow(),
      locationContext(),
    ]);
    const dto = toSellerDto(seller, ctx);
    return {
      seller: dto,
      counts: { products: Number(products.n), pending: Number(pending.n) },
      // What Blynk keeps (owner, 2026-10-24): the seller's own rate, else per category, else the default.
      commission_rule: await commissionRule(dto.commission_percent),
    };
  }

  async updateProfile(userId: string, input: ProfileInput) {
    const seller = await this.sellerOf(userId);
    if (seller.status === 'SUSPENDED') {
      throw new AppError('Your seller account is suspended.', 403, 'SELLER_SUSPENDED');
    }
    const ctx = await locationContext();
    // Before migration 053 a pin or a note cannot be kept: refuse (nothing saved) rather than drop
    // it silently. Nulls (nothing to keep) are ignored, so the rest of the profile still saves.
    if (!ctx.columns && (input.latitude != null || input.longitude != null || input.location_note != null)) {
      throw locationNotReady();
    }
    const updated = await db.transaction().execute(async (trx) => {
      // Locked so a location change is worked out from the row as Admin last left it.
      const current = await trx.selectFrom('sellers').selectAll().where('id', '=', seller.id).forUpdate().executeTakeFirstOrThrow();
      return trx
        .updateTable('sellers')
        .set({
          shop_name: input.shop_name,
          // Left out = unchanged; blank or null = cleared.
          ...(input.contact_name !== undefined ? { contact_name: input.contact_name } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
          ...(ctx.columns ? locationChange(current, input) : {}),
          updated_at: new Date(),
        })
        .where('id', '=', seller.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return { seller: toSellerDto(updated, ctx) };
  }

  async categories() {
    const rows = await db
      .selectFrom('categories')
      .select(['id', 'name', 'parent_id'])
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .orderBy('display_order', 'asc')
      .orderBy('name', 'asc')
      .execute();
    return { categories: rows };
  }

  async products(userId: string) {
    const seller = await this.sellerOf(userId);

    const [rows, subs, categoryRows] = await Promise.all([
      // One row per product with its stock (tracked rows only) and units delivered.
      sql<ProductRow>`
        SELECT p.id, p.category_id, c.name AS category_name, p.name, p.unit, p.pack_size, p.description,
               p.image_url, p.barcode, p.is_active, p.is_available, p.purchase_cost::text AS purchase_cost,
               p.pricing_mode, p.fixed_selling_price::text AS fixed_selling_price,
               p.custom_markup_percent::text AS custom_markup_percent, p.mrp::text AS mrp,
               (SELECT SUM(i.quantity_on_hand)::text FROM inventory i
                 WHERE i.product_id = p.id AND i.tracking_mode = 'TRACKED') AS stock_on_hand,
               COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o ON o.id = oi.order_id
                          WHERE oi.product_id = p.id AND o.order_status = 'DELIVERED'
                            AND oi.item_status NOT IN ('UNAVAILABLE', 'SUBSTITUTED')), 0)::text AS units_sold
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
         WHERE p.seller_id = ${seller.id} AND p.deleted_at IS NULL
         ORDER BY p.created_at DESC, p.name ASC`
        .execute(db)
        .then((r) => r.rows),
      db
        .selectFrom('seller_submissions')
        .selectAll()
        .where('seller_id', '=', seller.id)
        .where('status', '!=', 'WITHDRAWN')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute(),
      db.selectFrom('categories').select(['id', 'name']).where('deleted_at', 'is', null).execute(),
    ]);
    const categoryName = new Map(categoryRows.map((c) => [c.id, c.name]));

    // Newest first per product: the waiting EDIT, and a REJECTED one only while nothing newer came after it.
    const byProduct = new Map<string, SubmissionRow[]>();
    for (const s of subs) {
      if (s.product_id) byProduct.set(s.product_id, [...(byProduct.get(s.product_id) ?? []), s]);
    }

    const products: SellerProductDto[] = await Promise.all(
      rows.map(async (r) => {
        const list = byProduct.get(r.id) ?? [];
        const pending = list.find((s) => s.status === 'PENDING') ?? null;
        const newest = list[0] ?? null;
        const live = r.is_active;
        const price = live
          ? await priceForProduct({
              categoryId: r.category_id,
              purchaseCost: Number(r.purchase_cost),
              pricingMode: r.pricing_mode,
              fixedSellingPrice: r.fixed_selling_price === null ? null : Number(r.fixed_selling_price),
              customMarkupPercent: r.custom_markup_percent === null ? null : Number(r.custom_markup_percent),
              mrp: r.mrp === null ? null : Number(r.mrp),
            })
          : null;
        return {
          id: r.id,
          name: r.name,
          category_id: r.category_id,
          category_name: r.category_name,
          unit: r.unit,
          pack_size: r.pack_size,
          description: r.description,
          image_url: r.image_url,
          barcode: r.barcode,
          is_active: r.is_active,
          is_available: r.is_available,
          seller_price: Number(r.purchase_cost),
          selling_price: price ? price.sellingPrice : null,
          stock_on_hand: r.stock_on_hand === null ? null : Number(r.stock_on_hand),
          units_sold: Number(r.units_sold),
          live,
          pending: pending ? toSubmissionDto(pending) : null,
          last_rejected: newest && newest.status === 'REJECTED' ? toSubmissionDto(newest) : null,
        };
      })
    );

    // Proposals that are not a product yet: a waiting NEW one, or one Admin rejected.
    const proposals: SellerProductDto[] = subs
      .filter((s) => s.kind === 'NEW' && s.product_id === null && (s.status === 'PENDING' || s.status === 'REJECTED'))
      .map((s) => {
        const p = s.payload;
        const categoryId = text(p.category_id);
        return {
          id: `submission:${s.id}`,
          name: text(p.name) ?? '',
          category_id: categoryId,
          category_name: categoryId ? categoryName.get(categoryId) ?? null : null,
          unit: text(p.unit) ?? '',
          pack_size: text(p.pack_size),
          description: text(p.description),
          image_url: text(p.image_url),
          barcode: text(p.barcode),
          is_active: false,
          is_available: false,
          seller_price: Number(s.seller_price),
          selling_price: null,
          stock_on_hand: null,
          units_sold: 0,
          live: false,
          pending: s.status === 'PENDING' ? toSubmissionDto(s) : null,
          last_rejected: s.status === 'REJECTED' ? toSubmissionDto(s) : null,
        };
      });

    return { products: [...proposals, ...products] };
  }

  /** The category must exist, be active and not deleted. */
  private async assertCategory(categoryId: string): Promise<void> {
    const row = await db
      .selectFrom('categories')
      .select('id')
      .where('id', '=', categoryId)
      .where('is_active', '=', true)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row) throw new AppError('Choose one of the listed categories.', 400, 'CATEGORY_NOT_FOUND');
  }

  async createSubmission(userId: string, input: CreateProductInput) {
    const seller = await this.sellerOf(userId);
    this.assertApproved(seller);
    await this.assertCategory(input.category_id);
    const payload: SubmissionPayload = {
      name: input.name,
      category_id: input.category_id,
      unit: input.unit,
      pack_size: input.pack_size ?? null,
      description: input.description ?? null,
      image_url: input.image_url ?? null,
      barcode: input.barcode ?? null,
    };
    const row = await db
      .insertInto('seller_submissions')
      .values({ seller_id: seller.id, kind: 'NEW', payload: JSON.stringify(payload), seller_price: input.seller_price })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { submission: toSubmissionDto(row) };
  }

  /**
   * An edit of one of the seller's products. The proposal is the live values with the sent fields
   * replaced, so Admin sees the whole product; a waiting edit of the same product is WITHDRAWN
   * (one waiting edit per product). The live product itself is not touched.
   */
  async editSubmission(userId: string, productId: string, input: EditProductInput) {
    const seller = await this.sellerOf(userId);
    this.assertApproved(seller);
    if (input.category_id) await this.assertCategory(input.category_id);

    const row = await db.transaction().execute(async (trx) => {
      // The lock serialises two edits of one product, so the replaced one is always withdrawn first.
      const product = await trx
        .selectFrom('products')
        .select(['id', 'name', 'category_id', 'unit', 'pack_size', 'description', 'image_url', 'barcode', 'purchase_cost'])
        .where('id', '=', productId)
        .where('seller_id', '=', seller.id)
        .where('deleted_at', 'is', null)
        .forUpdate()
        .executeTakeFirst();
      if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');

      const payload: SubmissionPayload = {
        name: input.name ?? product.name,
        category_id: input.category_id ?? product.category_id,
        unit: input.unit ?? product.unit,
        pack_size: input.pack_size !== undefined ? input.pack_size : product.pack_size,
        description: input.description !== undefined ? input.description : product.description,
        image_url: input.image_url !== undefined ? input.image_url : product.image_url,
        barcode: input.barcode !== undefined ? input.barcode : product.barcode,
      };

      await trx
        .updateTable('seller_submissions')
        .set({ status: 'WITHDRAWN', updated_at: new Date() })
        .where('product_id', '=', product.id)
        .where('kind', '=', 'EDIT')
        .where('status', '=', 'PENDING')
        .execute();

      return trx
        .insertInto('seller_submissions')
        .values({
          seller_id: seller.id,
          product_id: product.id,
          kind: 'EDIT',
          payload: JSON.stringify(payload),
          seller_price: input.seller_price ?? Number(product.purchase_cost),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    return { submission: toSubmissionDto(row) };
  }

  async withdraw(userId: string, submissionId: string) {
    const seller = await this.sellerOf(userId);
    const withdrawn = await db
      .updateTable('seller_submissions')
      .set({ status: 'WITHDRAWN', updated_at: new Date() })
      .where('id', '=', submissionId)
      .where('seller_id', '=', seller.id)
      .where('status', '=', 'PENDING')
      .returningAll()
      .executeTakeFirst();
    if (withdrawn) return { submission: toSubmissionDto(withdrawn) };

    const existing = await db
      .selectFrom('seller_submissions')
      .select('status')
      .where('id', '=', submissionId)
      .where('seller_id', '=', seller.id)
      .executeTakeFirst();
    if (!existing) throw new AppError('Submission not found.', 404, 'SUBMISSION_NOT_FOUND');
    throw new AppError('Only a submission that is still waiting can be withdrawn.', 409, 'SUBMISSION_NOT_PENDING', {
      status: existing.status,
    });
  }

  async statement(userId: string, range: { from?: string; to?: string }): Promise<Statement> {
    const seller = await this.sellerOf(userId);
    return sellerStatement(seller.id, range);
  }
}

export const sellerService = new SellerService();
