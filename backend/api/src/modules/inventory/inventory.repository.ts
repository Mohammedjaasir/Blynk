import { Transaction, sql } from 'kysely';
import { ITEM_WORK_STATES } from '../orders/lifecycle/catalogue.js';
import { db } from '../../database/connection.js';
import {
  Database,
  InventoryTrackingMode,
  InventoryAdjustmentType,
  ItemFulfillmentStatus,
  UserRole,
} from '../../database/types.js';
import { AppError } from '../../middleware/error.middleware.js';
import { AdjustmentsQueryInput, InventoryQueryInput } from './inventory.schema.js';
import { lockInventoryRow, recordStockMovement } from './stock-ledger.js';

export type DBConnection = Transaction<Database> | typeof db;

/** Escapes LIKE wildcards so a search for "50%" matches literally. */
const likeTerm = (value: string) => `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Postgres unique violation on suppliers.code (the table's only unique column). */
function rethrowSupplierCodeConflict(err: unknown): never {
  if (err && typeof err === 'object' && (err as { code?: string }).code === '23505') {
    throw new AppError('Another supplier already uses this code.', 409, 'SUPPLIER_CODE_TAKEN');
  }
  throw err;
}

export interface SourceItemParams {
  orderId: string;
  itemId: string;
  actualUnitCost: number;
  quantity?: number;
  supplierId?: string;
  supplierName?: string;
  notes?: string;
  userId?: string;
  /** Only an ADMIN may create a supplier by naming it (supplier CRUD is ADMIN-only; plan I4). */
  actorRole: UserRole;
}

export interface AdjustStockParams {
  productId: string;
  darkStoreId: string;
  quantityDelta: number;
  adjustmentType: InventoryAdjustmentType;
  notes?: string;
  referenceOrderId?: string;
  userId?: string;
}

export class InventoryRepository {
  /**
   * Atomic Order Item Sourcing Execution.
   * Locks item, records actual unit cost without modifying estimated cost or customer prices,
   * inserts an immutable sourcing record, and handles tracked stock fulfillment if applicable.
   */
  async sourceOrderItemAtomic(params: SourceItemParams, executor: DBConnection = db) {
    return await executor.transaction().execute(async (trx: Transaction<Database>) => {
      // 1. Fetch and row-lock the order item
      const item = await trx
        .selectFrom('order_items')
        .selectAll()
        .where('id', '=', params.itemId)
        .forUpdate()
        .executeTakeFirst();

      if (!item) {
        throw new AppError('Order item not found.', 404, 'ORDER_ITEM_NOT_FOUND', {
          item_id: params.itemId,
        });
      }

      // IDOR validation: Verify item belongs to the specified order
      if (item.order_id !== params.orderId) {
        throw new AppError(
          'Order item does not belong to the specified order.',
          400,
          'ORDER_ITEM_MISMATCH',
          { item_id: params.itemId, order_id: params.orderId }
        );
      }

      // Sourcing eligibility: Cannot source an item that is marked UNAVAILABLE or already PACKED
      if (item.item_status === 'UNAVAILABLE') {
        throw new AppError(
          'Cannot source an item that is marked UNAVAILABLE.',
          400,
          'CANNOT_SOURCE_UNAVAILABLE_ITEM',
          { item_id: params.itemId, current_status: item.item_status }
        );
      }

      // An item is sourced once. Without this a retry or a second operator
      // records a second cost and, for a TRACKED product, takes stock twice.
      // The row lock above makes a concurrent second call wait, then see the
      // first call's SOURCED status here.
      if (item.item_status === 'SOURCED' || item.item_status === 'PACKED') {
        throw new AppError('This item has already been sourced.', 409, 'ITEM_ALREADY_SOURCED', {
          item_id: params.itemId,
          current_status: item.item_status,
        });
      }

      // Quantity validation
      const qtyToSource = params.quantity ?? item.quantity;
      if (qtyToSource <= 0 || qtyToSource > item.quantity) {
        throw new AppError(
          `Sourced quantity (${qtyToSource}) must be between 1 and ordered quantity (${item.quantity}).`,
          400,
          'INVALID_SOURCING_QUANTITY',
          { ordered_quantity: item.quantity, attempted_quantity: qtyToSource }
        );
      }

      // 2. Fetch order to get dark store context
      const order = await trx
        .selectFrom('orders')
        .select(['id', 'dark_store_id', 'order_status', 'order_number'])
        .where('id', '=', params.orderId)
        .forUpdate()
        .executeTakeFirstOrThrow();

      // Items are sourced only while the order is being packed (lifecycle
      // ITEM_WORK_STATES, D9); the code is the Inventory app's contract.
      if (!ITEM_WORK_STATES.includes(order.order_status)) {
        throw new AppError(
          `Cannot source items for order with status '${order.order_status}'.`,
          400,
          'ORDER_NOT_IN_SOURCING_STATE',
          { order_id: params.orderId, order_status: order.order_status }
        );
      }

      // 3. Resolve supplier if provided
      let resolvedSupplierId: string | null = null;
      if (params.supplierId) {
        const supplier = await trx
          .selectFrom('suppliers')
          .selectAll()
          .where('id', '=', params.supplierId)
          .executeTakeFirst();

        if (!supplier) {
          throw new AppError('Specified supplier not found.', 404, 'SUPPLIER_NOT_FOUND', {
            supplier_id: params.supplierId,
          });
        }
        if (!supplier.is_active) {
          throw new AppError('Specified supplier is inactive.', 400, 'SUPPLIER_INACTIVE', {
            supplier_id: params.supplierId,
          });
        }
        resolvedSupplierId = supplier.id;
      } else if (params.supplierName) {
        // A named supplier: the active one of that name (names are not
        // unique; oldest first so the choice never varies). An inactive
        // supplier is refused exactly as by id, and creating a new supplier
        // on the fly is supplier management - ADMIN only (plan I4).
        const named = await trx
          .selectFrom('suppliers')
          .selectAll()
          .where('name', '=', params.supplierName)
          .orderBy('is_active', 'desc')
          .orderBy('created_at', 'asc')
          .orderBy('id', 'asc')
          .executeTakeFirst();
        let supplier = named?.is_active ? named : undefined;

        if (named && !named.is_active) {
          throw new AppError('Specified supplier is inactive.', 400, 'SUPPLIER_INACTIVE', {
            supplier_id: named.id,
          });
        }
        if (!supplier && params.actorRole !== 'ADMIN') {
          throw new AppError('Only an admin can add a new supplier.', 403, 'FORBIDDEN');
        }

        if (!supplier) {
          const [newSupplier] = await trx
            .insertInto('suppliers')
            .values({
              name: params.supplierName,
              is_active: true,
            })
            .returningAll()
            .execute();
          supplier = newSupplier;
        }
        resolvedSupplierId = supplier.id;
      }

      // 4. Update order item:
      // Invariant: estimated_unit_cost remains UNCHANGED.
      // Invariant: unit_selling_price remains UNCHANGED.
      // Invariant: actual_unit_cost is recorded as the authoritative procurement price.
      const roundedActualCost = Number(params.actualUnitCost.toFixed(2));
      const [updatedItem] = await trx
        .updateTable('order_items')
        .set({
          actual_unit_cost: roundedActualCost,
          item_status: 'SOURCED' as ItemFulfillmentStatus,
        })
        .where('id', '=', params.itemId)
        .returningAll()
        .execute();

      // 5. Insert immutable sourcing record for audit trail
      const [sourcingRecord] = await trx
        .insertInto('sourcing_records')
        .values({
          order_id: params.orderId,
          order_item_id: params.itemId,
          product_id: item.product_id,
          supplier_id: resolvedSupplierId,
          quantity_sourced: qtyToSource,
          estimated_unit_cost: item.estimated_unit_cost,
          actual_unit_cost: roundedActualCost,
          sourcing_status: 'SOURCED',
          notes: params.notes ?? null,
          sourced_by_user_id: params.userId ?? null,
        })
        .returningAll()
        .execute();

      // 6. A TRACKED product's units leave the counted shelf into this
      // order's bag (ORDER_FULFILLMENT), through the canonical stock writer.
      // Lock order: item -> order -> inventory row.
      const inventoryRow = await lockInventoryRow(trx, order.dark_store_id, item.product_id);

      if (inventoryRow && inventoryRow.tracking_mode === 'TRACKED') {
        if (inventoryRow.quantity_on_hand < qtyToSource) {
          throw new AppError(
            `Insufficient tracked inventory for product. On hand: ${inventoryRow.quantity_on_hand}, required: ${qtyToSource}`,
            409,
            'INSUFFICIENT_TRACKED_INVENTORY',
            {
              product_id: item.product_id,
              on_hand: inventoryRow.quantity_on_hand,
              requested: qtyToSource,
            }
          );
        }

        await recordStockMovement(trx, {
          inventory: inventoryRow,
          delta: -qtyToSource,
          type: 'ORDER_FULFILLMENT',
          orderId: params.orderId,
          actorId: params.userId ?? null,
          notes: `Order ${order.order_number} item sourcing fulfillment`,
        });
      }

      return {
        item: {
          ...updatedItem,
          unit_selling_price: Number(Number(updatedItem.unit_selling_price).toFixed(2)),
          estimated_unit_cost: Number(Number(updatedItem.estimated_unit_cost).toFixed(2)),
          actual_unit_cost: Number(Number(updatedItem.actual_unit_cost).toFixed(2)),
          subtotal: Number(Number(updatedItem.subtotal).toFixed(2)),
        },
        sourcing_record: {
          ...sourcingRecord,
          estimated_unit_cost: Number(Number(sourcingRecord.estimated_unit_cost).toFixed(2)),
          actual_unit_cost: Number(Number(sourcingRecord.actual_unit_cost).toFixed(2)),
        },
      };
    });
  }

  /**
   * Retrieves full sourcing progress for an order with all items and sourcing audit logs.
   */
  async getOrderSourcingDetails(orderId: string, executor: DBConnection = db) {
    const order = await executor
      .selectFrom('orders')
      .selectAll()
      .where('id', '=', orderId)
      .executeTakeFirst();

    if (!order) return null;

    const [items, records] = await Promise.all([
      // Items of one order are inserted in one transaction and share
      // created_at, so the tiebreaks are what actually order them: by product
      // name (an alphabetical pick list), then id so the order never varies.
      executor
        .selectFrom('order_items')
        .selectAll()
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'asc')
        .orderBy('product_name_snapshot', 'asc')
        .orderBy('id', 'asc')
        .execute(),
      executor
        .selectFrom('sourcing_records')
        .selectAll()
        .where('order_id', '=', orderId)
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute(),
    ]);

    // Fetch suppliers referenced in sourcing records
    const supplierIds = records
      .map((r: { supplier_id: string | null }) => r.supplier_id)
      .filter((id: string | null): id is string => id !== null);

    const suppliers = supplierIds.length > 0
      ? await executor
          .selectFrom('suppliers')
          .selectAll()
          .where('id', 'in', supplierIds)
          .execute()
      : [];

    const supplierMap = new Map(suppliers.map((s: { id: string }) => [s.id, s]));

    const formattedItems = items.map((it: typeof items[number]) => {
      const itemRecords = records
        .filter((r: typeof records[number]) => r.order_item_id === it.id)
        .map((r: typeof records[number]) => ({
          ...r,
          estimated_unit_cost: Number(Number(r.estimated_unit_cost).toFixed(2)),
          actual_unit_cost: Number(Number(r.actual_unit_cost).toFixed(2)),
          supplier: r.supplier_id ? supplierMap.get(r.supplier_id) ?? null : null,
        }));

      return {
        ...it,
        unit_selling_price: Number(Number(it.unit_selling_price).toFixed(2)),
        estimated_unit_cost: Number(Number(it.estimated_unit_cost).toFixed(2)),
        actual_unit_cost: it.actual_unit_cost !== null ? Number(Number(it.actual_unit_cost).toFixed(2)) : null,
        subtotal: Number(Number(it.subtotal).toFixed(2)),
        sourcing_records: itemRecords,
      };
    });

    const totalItems = items.length;
    const sourcedItems = items.filter((it: typeof items[number]) => it.item_status === 'SOURCED').length;
    const unavailableItems = items.filter((it: typeof items[number]) => it.item_status === 'UNAVAILABLE').length;
    const pendingItems = items.filter((it: typeof items[number]) => it.item_status === 'PENDING').length;

    return {
      order_id: order.id,
      order_number: order.order_number,
      order_status: order.order_status,
      dark_store_id: order.dark_store_id,
      metrics: {
        total_items: totalItems,
        sourced_items: sourcedItems,
        unavailable_items: unavailableItems,
        pending_items: pendingItems,
        is_sourcing_complete: pendingItems === 0,
      },
      items: formattedItems,
    };
  }

  // ==========================================================================
  // TRACKED INVENTORY & LEDGER OPERATIONS
  // ==========================================================================

  /**
   * Stock status for every catalog product in one dark store.
   *
   * Starts from products, not from inventory: a product created in Admin has
   * no inventory row until someone tracks it, and must still be visible to
   * Inventory. Such a product reads as UNTRACKED with zero stock - the same
   * default GET /inventory/:productId returns - and reading creates no row.
   */
  async listInventory(
    filters: InventoryQueryInput & { dark_store_id: string },
    executor: DBConnection = db
  ) {
    const storeId = filters.dark_store_id;

    const base = () => {
      let query = executor
        .selectFrom('products as p')
        .innerJoin('categories as c', 'c.id', 'p.category_id')
        .leftJoin('inventory as inv', (join) =>
          join.onRef('inv.product_id', '=', 'p.id').on('inv.dark_store_id', '=', storeId)
        )
        .leftJoin('dark_stores as ds', 'ds.id', 'inv.dark_store_id');

      if (!filters.include_inactive) {
        query = query.where('p.is_active', '=', true);
      }
      if (filters.tracking_mode === 'TRACKED') {
        query = query.where('inv.tracking_mode', '=', 'TRACKED');
      } else if (filters.tracking_mode === 'UNTRACKED') {
        query = query.where((eb) =>
          eb.or([eb('inv.tracking_mode', 'is', null), eb('inv.tracking_mode', '=', 'UNTRACKED')])
        );
      }
      if (filters.low_stock_only) {
        query = query
          .where('inv.tracking_mode', '=', 'TRACKED')
          .whereRef('inv.quantity_on_hand', '<=', 'inv.low_stock_threshold');
      }
      if (filters.search) {
        const term = likeTerm(filters.search);
        query = query.where((eb) => eb.or([eb('p.name', 'ilike', term), eb('p.sku', 'ilike', term)]));
      }
      return query;
    };

    const rows = await base()
      .select([
        'inv.id as inventory_id',
        sql<string>`coalesce(inv.dark_store_id, ${storeId})`.as('dark_store_id'),
        'ds.name as dark_store_name',
        'p.id as product_id',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.unit as product_unit',
        'c.name as category_name',
        'p.is_active',
        'p.is_available',
        sql<InventoryTrackingMode>`coalesce(inv.tracking_mode, 'UNTRACKED')`.as('tracking_mode'),
        sql<number>`coalesce(inv.quantity_on_hand, 0)`.as('quantity_on_hand'),
        sql<number>`coalesce(inv.quantity_reserved, 0)`.as('quantity_reserved'),
        // 5 is the inventory table's column default, used until a row exists.
        sql<number>`coalesce(inv.low_stock_threshold, 5)`.as('low_stock_threshold'),
        'inv.updated_at',
      ])
      .orderBy('p.name', 'asc')
      .orderBy('p.id', 'asc')
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit)
      .execute();

    const totalResult = await base()
      .select((eb) => eb.fn.countAll().as('total'))
      .executeTakeFirst();
    const total = Number(totalResult?.total ?? 0);

    return {
      inventory: rows.map((r) => ({
        ...r,
        quantity_available: r.quantity_on_hand - r.quantity_reserved,
        is_low_stock: r.tracking_mode === 'TRACKED' && r.quantity_on_hand <= r.low_stock_threshold,
      })),
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        total_pages: Math.ceil(total / filters.limit) || 1,
      },
    };
  }

  /**
   * The adjustment ledger across products, newest first, with the product and
   * the person who recorded each entry. Read-only: the ledger is append-only
   * and has no update or delete path.
   */
  async listAdjustments(filters: AdjustmentsQueryInput, executor: DBConnection = db) {
    const base = () => {
      let query = executor
        .selectFrom('inventory_adjustments as a')
        .innerJoin('inventory as inv', 'inv.id', 'a.inventory_id')
        .innerJoin('products as p', 'p.id', 'inv.product_id')
        .leftJoin('users as u', 'u.id', 'a.created_by_user_id');

      if (filters.product_id) query = query.where('inv.product_id', '=', filters.product_id);
      if (filters.type) query = query.where('a.adjustment_type', '=', filters.type);
      if (filters.from) query = query.where('a.created_at', '>=', filters.from);
      if (filters.to) query = query.where('a.created_at', '<=', filters.to);
      return query;
    };

    const rows = await base()
      .select([
        'a.id',
        'a.inventory_id',
        'inv.product_id',
        'inv.dark_store_id',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.unit as product_unit',
        'a.adjustment_type',
        'a.quantity_delta',
        'a.previous_quantity',
        'a.new_quantity',
        'a.reference_order_id',
        'a.notes',
        'a.created_by_user_id',
        'u.full_name as actor_name',
        // A customer's cancellation returns stock too (plan I7): the role lets
        // Inventory tell a customer apart from a colleague.
        'u.role as actor_role',
        'a.created_at',
      ])
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(filters.limit)
      .offset((filters.page - 1) * filters.limit)
      .execute();

    const totalResult = await base()
      .select((eb) => eb.fn.countAll().as('total'))
      .executeTakeFirst();
    const total = Number(totalResult?.total ?? 0);

    return {
      adjustments: rows,
      pagination: {
        page: filters.page,
        limit: filters.limit,
        total,
        total_pages: Math.ceil(total / filters.limit) || 1,
      },
    };
  }

  /**
   * Retrieves single product inventory with adjustment history.
   */
  async getInventoryByProduct(productId: string, darkStoreId?: string, executor: DBConnection = db) {
    let query = executor
      .selectFrom('inventory as inv')
      .innerJoin('products as p', 'p.id', 'inv.product_id')
      .innerJoin('dark_stores as ds', 'ds.id', 'inv.dark_store_id')
      .select([
        'inv.id as inventory_id',
        'inv.dark_store_id',
        'ds.name as dark_store_name',
        'inv.product_id',
        'p.name as product_name',
        'p.sku as product_sku',
        'p.purchase_cost',
        'inv.tracking_mode',
        'inv.quantity_on_hand',
        'inv.quantity_reserved',
        'inv.low_stock_threshold',
        'inv.updated_at',
      ])
      .where('inv.product_id', '=', productId);

    if (darkStoreId) {
      query = query.where('inv.dark_store_id', '=', darkStoreId);
    }

    const inv = await query.executeTakeFirst();
    if (!inv) return null;

    // Fetch adjustment history
    const adjustments = await executor
      .selectFrom('inventory_adjustments as a')
      .leftJoin('users as u', 'u.id', 'a.created_by_user_id')
      .selectAll('a')
      .select(['u.full_name as actor_name', 'u.role as actor_role'])
      .where('a.inventory_id', '=', inv.inventory_id)
      .orderBy('a.created_at', 'desc')
      .orderBy('a.id', 'desc')
      .limit(50)
      .execute();

    return {
      ...inv,
      quantity_available: inv.quantity_on_hand - inv.quantity_reserved,
      is_low_stock: inv.tracking_mode === 'TRACKED' && inv.quantity_on_hand <= inv.low_stock_threshold,
      adjustments,
    };
  }

  /**
   * Toggles inventory tracking mode between UNTRACKED and TRACKED.
   */
  async setTrackingMode(
    productId: string,
    darkStoreId: string,
    trackingMode: InventoryTrackingMode,
    executor: DBConnection = db
  ) {
    return await executor.transaction().execute(async (trx: Transaction<Database>) => {
      // Check if inventory row exists
      const existing = await trx
        .selectFrom('inventory')
        .selectAll()
        .where('dark_store_id', '=', darkStoreId)
        .where('product_id', '=', productId)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) {
        // Create initial inventory row
        const [created] = await trx
          .insertInto('inventory')
          .values({
            dark_store_id: darkStoreId,
            product_id: productId,
            tracking_mode: trackingMode,
            quantity_on_hand: 0,
            quantity_reserved: 0,
          })
          .returningAll()
          .execute();
        return created;
      }

      const [updated] = await trx
        .updateTable('inventory')
        .set({
          tracking_mode: trackingMode,
          updated_at: new Date(),
        })
        .where('id', '=', existing.id)
        .returningAll()
        .execute();

      return updated;
    });
  }

  /**
   * Atomic stock adjustment with immutable ledger record.
   */
  async adjustStockAtomic(params: AdjustStockParams, executor: DBConnection = db) {
    return await executor.transaction().execute(async (trx: Transaction<Database>) => {
      // Manual adjustments apply to TRACKED products only: an UNTRACKED
      // product's quantities are never read, so a count recorded against it
      // would mean nothing. Tracking is switched on explicitly (PATCH …/mode),
      // never as a side effect of an adjustment.
      const inv = await lockInventoryRow(trx, params.darkStoreId, params.productId);

      if (!inv || inv.tracking_mode !== 'TRACKED') {
        throw new AppError(
          'Stock can only be adjusted for a tracked product. Switch it to TRACKED first.',
          409,
          'PRODUCT_NOT_TRACKED',
          { product_id: params.productId, tracking_mode: inv?.tracking_mode ?? 'UNTRACKED' }
        );
      }

      const { inventory: updatedInv, adjustment } = await recordStockMovement(trx, {
        inventory: inv,
        delta: params.quantityDelta,
        type: params.adjustmentType,
        orderId: params.referenceOrderId ?? null,
        actorId: params.userId ?? null,
        notes: params.notes ?? null,
      });

      return {
        inventory: {
          ...updatedInv,
          quantity_available: updatedInv.quantity_on_hand - updatedInv.quantity_reserved,
        },
        adjustment,
      };
    });
  }

  // ==========================================================================
  // SUPPLIER / MARKET SOURCE OPERATIONS
  // ==========================================================================

  async createSupplier(data: {
    name: string;
    code?: string;
    contact_person?: string;
    contact_phone?: string;
    address?: string;
    notes?: string;
  }) {
    const [supplier] = await db
      .insertInto('suppliers')
      .values({
        name: data.name,
        code: data.code ?? null,
        contact_person: data.contact_person ?? null,
        contact_phone: data.contact_phone ?? null,
        address: data.address ?? null,
        notes: data.notes ?? null,
        is_active: true,
      })
      .returningAll()
      .execute()
      .catch(rethrowSupplierCodeConflict);

    return supplier;
  }

  async findSuppliers(activeOnly = true) {
    let query = db.selectFrom('suppliers').selectAll();
    if (activeOnly) {
      query = query.where('is_active', '=', true);
    }
    return await query.orderBy('name', 'asc').execute();
  }

  async findSupplierById(id: string) {
    return await db
      .selectFrom('suppliers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async updateSupplier(
    id: string,
    data: {
      name?: string;
      code?: string;
      contact_person?: string;
      contact_phone?: string;
      address?: string;
      notes?: string;
      is_active?: boolean;
    }
  ) {
    const [updated] = await db
      .updateTable('suppliers')
      .set({
        ...data,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .execute()
      .catch(rethrowSupplierCodeConflict);

    return updated || null;
  }
}

export const inventoryRepository = new InventoryRepository();
