import { Request, Response, NextFunction } from 'express';
import { inventoryService } from './inventory.service.js';
import {
  sourceOrderItemSchema,
  adjustStockSchema,
  updateInventoryModeSchema,
  createSupplierSchema,
  updateSupplierSchema,
  inventoryQuerySchema,
  adjustmentsQuerySchema,
  productIdParamsSchema,
  productStockQuerySchema,
  sourceItemParamsSchema,
  sourcingOrderParamsSchema,
  supplierIdParamsSchema,
} from './inventory.schema.js';

export class InventoryController {
  // --------------------------------------------------------------------------
  // ORDER SOURCING CONTROLLERS
  // --------------------------------------------------------------------------

  async sourceOrderItem(req: Request, res: Response, next: NextFunction) {
    try {
      const { id, itemId } = sourceItemParamsSchema.parse(req.params);
      const input = sourceOrderItemSchema.parse(req.body);
      const result = await inventoryService.sourceOrderItem(id, itemId, input, {
        id: req.user!.id,
        role: req.user!.role,
      });

      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getOrderSourcing(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = sourcingOrderParamsSchema.parse(req.params);
      const details = await inventoryService.getOrderSourcingDetails(id);
      res.status(200).json({
        success: true,
        data: details,
      });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // TRACKED INVENTORY CONTROLLERS
  // --------------------------------------------------------------------------

  async listInventory(req: Request, res: Response, next: NextFunction) {
    try {
      const query = inventoryQuerySchema.parse(req.query);
      const result = await inventoryService.listInventory(query);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async listAdjustments(req: Request, res: Response, next: NextFunction) {
    try {
      const query = adjustmentsQuerySchema.parse(req.query);
      const result = await inventoryService.listAdjustments(query);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getInventoryByProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = productIdParamsSchema.parse(req.params);
      const { dark_store_id: darkStoreId } = productStockQuerySchema.parse(req.query);
      const result = await inventoryService.getInventoryByProduct(productId, darkStoreId);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async setTrackingMode(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = productIdParamsSchema.parse(req.params);
      const input = updateInventoryModeSchema.parse(req.body);
      const result = await inventoryService.setTrackingMode(productId, input);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async adjustStock(req: Request, res: Response, next: NextFunction) {
    try {
      const { productId } = productIdParamsSchema.parse(req.params);
      const input = adjustStockSchema.parse(req.body);
      const result = await inventoryService.adjustStock(productId, input, req.user?.id);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // SUPPLIER MANAGEMENT CONTROLLERS
  // --------------------------------------------------------------------------

  async createSupplier(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createSupplierSchema.parse(req.body);
      const supplier = await inventoryService.createSupplier(input);
      res.status(201).json({
        success: true,
        data: { supplier },
      });
    } catch (err) {
      next(err);
    }
  }

  async listSuppliers(req: Request, res: Response, next: NextFunction) {
    try {
      const activeOnly = req.query.active_only !== 'false';
      const suppliers = await inventoryService.listSuppliers(activeOnly);
      res.status(200).json({
        success: true,
        data: { suppliers },
      });
    } catch (err) {
      next(err);
    }
  }

  async getSupplierById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = supplierIdParamsSchema.parse(req.params);
      const supplier = await inventoryService.getSupplierById(id);
      res.status(200).json({
        success: true,
        data: { supplier },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateSupplier(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = supplierIdParamsSchema.parse(req.params);
      const input = updateSupplierSchema.parse(req.body);
      const supplier = await inventoryService.updateSupplier(id, input);
      res.status(200).json({
        success: true,
        data: { supplier },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const inventoryController = new InventoryController();
