import { inventoryRepository } from './inventory.repository.js';
import {
  SourceOrderItemInput,
  AdjustStockInput,
  UpdateInventoryModeInput,
  CreateSupplierInput,
  UpdateSupplierInput,
  InventoryQueryInput,
  AdjustmentsQueryInput,
} from './inventory.schema.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import { db } from '../../database/connection.js';
import type { UserRole } from '../../database/types.js';

// Default Central Dharga Town Hub fallback ID
const DEFAULT_DARK_STORE_ID = '018dc3f0-4a82-789a-8b1b-947f61ad8821';

export class InventoryService {
  /**
   * Sources an order item, recording authoritative procurement cost.
   * Preserves historical estimated cost snapshot and customer selling price.
   */
  async sourceOrderItem(
    orderId: string,
    itemId: string,
    input: SourceOrderItemInput,
    actor: { id: string; role: UserRole }
  ) {
    const userId = actor.id;
    const result = await inventoryRepository.sourceOrderItemAtomic({
      orderId,
      itemId,
      actualUnitCost: input.actual_unit_cost,
      quantity: input.quantity,
      supplierId: input.supplier_id,
      supplierName: input.supplier_name,
      notes: input.notes,
      userId,
      actorRole: actor.role,
    });

    logger.info(
      {
        orderId,
        itemId,
        actualUnitCost: result.item.actual_unit_cost,
        estimatedUnitCost: result.item.estimated_unit_cost,
        sellingPrice: result.item.unit_selling_price,
        userId,
      },
      'Order item sourced successfully with actual procurement cost recorded'
    );

    return result;
  }

  /**
   * Retrieves full sourcing progress for an order.
   */
  async getOrderSourcingDetails(orderId: string) {
    const details = await inventoryRepository.getOrderSourcingDetails(orderId);
    if (!details) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND', { order_id: orderId });
    }
    return details;
  }

  /**
   * Lists stock status for every catalog product in a dark store (the
   * default store unless one is given), including products with no
   * inventory row yet.
   */
  async listInventory(query: InventoryQueryInput) {
    return await inventoryRepository.listInventory({
      ...query,
      dark_store_id: query.dark_store_id ?? DEFAULT_DARK_STORE_ID,
    });
  }

  /**
   * The adjustment ledger across products, newest first.
   */
  async listAdjustments(query: AdjustmentsQueryInput) {
    return await inventoryRepository.listAdjustments(query);
  }

  /**
   * Retrieves single product inventory and adjustment history.
   */
  async getInventoryByProduct(productId: string, darkStoreId?: string) {
    // Validate product exists first
    const product = await db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', '=', productId)
      .executeTakeFirst();

    if (!product) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND', { product_id: productId });
    }

    const inventory = await inventoryRepository.getInventoryByProduct(productId, darkStoreId);
    if (!inventory) {
      // Return default UNTRACKED representation if not yet initialized in inventory table
      return {
        product_id: product.id,
        product_name: product.name,
        tracking_mode: 'UNTRACKED',
        quantity_on_hand: 0,
        quantity_reserved: 0,
        quantity_available: 0,
        low_stock_threshold: 5,
        is_low_stock: false,
        adjustments: [],
      };
    }

    return inventory;
  }

  /**
   * Switches inventory tracking mode between UNTRACKED and TRACKED.
   */
  async setTrackingMode(productId: string, input: UpdateInventoryModeInput) {
    // Validate product exists
    const product = await db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', '=', productId)
      .executeTakeFirst();

    if (!product) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND', { product_id: productId });
    }

    const storeId = input.dark_store_id ?? DEFAULT_DARK_STORE_ID;
    const updated = await inventoryRepository.setTrackingMode(productId, storeId, input.tracking_mode);

    logger.info(
      { productId, darkStoreId: storeId, mode: input.tracking_mode },
      'Product inventory tracking mode updated'
    );

    return updated;
  }

  /**
   * Records a manual stock receipt, restock, damage write-off, or audit adjustment.
   */
  async adjustStock(productId: string, input: AdjustStockInput, userId?: string) {
    // Validate product exists
    const product = await db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', '=', productId)
      .executeTakeFirst();

    if (!product) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND', { product_id: productId });
    }

    const storeId = input.dark_store_id ?? DEFAULT_DARK_STORE_ID;
    const result = await inventoryRepository.adjustStockAtomic({
      productId,
      darkStoreId: storeId,
      quantityDelta: input.quantity_delta,
      adjustmentType: input.adjustment_type,
      notes: input.notes,
      userId,
    });

    logger.info(
      {
        productId,
        darkStoreId: storeId,
        adjustmentType: input.adjustment_type,
        delta: input.quantity_delta,
        newQuantity: result.inventory.quantity_on_hand,
        userId,
      },
      'Inventory stock adjusted and recorded in immutable ledger'
    );

    return result;
  }

  // ==========================================================================
  // SUPPLIER MANAGEMENT
  // ==========================================================================

  async createSupplier(input: CreateSupplierInput) {
    return await inventoryRepository.createSupplier(input);
  }

  async listSuppliers(activeOnly = true) {
    return await inventoryRepository.findSuppliers(activeOnly);
  }

  async getSupplierById(id: string) {
    const supplier = await inventoryRepository.findSupplierById(id);
    if (!supplier) {
      throw new AppError('Supplier not found.', 404, 'SUPPLIER_NOT_FOUND', { supplier_id: id });
    }
    return supplier;
  }

  async updateSupplier(id: string, input: UpdateSupplierInput) {
    const supplier = await inventoryRepository.updateSupplier(id, input);
    if (!supplier) {
      throw new AppError('Supplier not found.', 404, 'SUPPLIER_NOT_FOUND', { supplier_id: id });
    }
    return supplier;
  }
}

export const inventoryService = new InventoryService();
