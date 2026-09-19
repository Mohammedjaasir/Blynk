import { Request, Response, NextFunction } from 'express';
import { orderService } from './order.service.js';
import {
  createOrderSchema,
  cancelOrderSchema,
  orderQuerySchema,
  adminUpdateOrderStatusSchema,
  adminAssignRiderSchema,
  adminOrderQuerySchema,
  resolveItemSchema,
  orderItemParamsSchema,
} from './order.schema.js';

export class OrderController {
  // --------------------------------------------------------------------------
  // CUSTOMER ENDPOINTS
  // --------------------------------------------------------------------------

  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createOrderSchema.parse(req.body);
      const idempotencyHeader = (req.headers['idempotency-key'] || req.headers['x-idempotency-key']) as
        | string
        | undefined;

      const result = await orderService.createOrder(req.user!.id, input, idempotencyHeader);

      const status = result.is_idempotent_replay ? 200 : 201;
      res.status(status).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getCustomerOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const query = orderQuerySchema.parse(req.query);
      const result = await orderService.getCustomerOrders(req.user!.id, query);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getCustomerOrderById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = orderItemParamsSchema.parse(req.params);
      const order = await orderService.getCustomerOrderById(id, req.user!.id);
      res.status(200).json({
        success: true,
        data: { order },
      });
    } catch (err) {
      next(err);
    }
  }

  async cancelOrder(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = orderItemParamsSchema.parse(req.params);
      const input = cancelOrderSchema.parse(req.body);
      const order = await orderService.cancelOrderCustomer(
        id,
        { id: req.user!.id, role: req.user!.role },
        input.reason
      );
      res.status(200).json({
        success: true,
        data: { order },
      });
    } catch (err) {
      next(err);
    }
  }

  // --------------------------------------------------------------------------
  // ADMIN / STORE OPS ENDPOINTS
  // --------------------------------------------------------------------------

  async getPackingQueue(_req: Request, res: Response, next: NextFunction) {
    try {
      const queue = await orderService.getPackingQueue();
      res.status(200).json({
        success: true,
        data: { queue },
      });
    } catch (err) {
      next(err);
    }
  }

  async getAdminOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const query = adminOrderQuerySchema.parse(req.query);
      const result = await orderService.getAdminOrders(query);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (err) {
      next(err);
    }
  }

  async getAdminOrderById(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = orderItemParamsSchema.parse(req.params);
      const order = await orderService.getAdminOrderById(id);
      res.status(200).json({
        success: true,
        data: { order },
      });
    } catch (err) {
      next(err);
    }
  }

  async updateOrderStatusAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = orderItemParamsSchema.parse(req.params);
      const input = adminUpdateOrderStatusSchema.parse(req.body);
      const order = await orderService.updateOrderStatusAdmin(
        id,
        input.status,
        { id: req.user!.id, role: req.user!.role },
        input.notes
      );
      res.status(200).json({
        success: true,
        data: { order },
      });
    } catch (err) {
      next(err);
    }
  }

  async resolveUnavailableItem(req: Request, res: Response, next: NextFunction) {
    try {
      const params = orderItemParamsSchema.parse(req.params);
      const input = resolveItemSchema.parse(req.body);
      // PATCH /orders/:id/items/:itemId — item ID from route param
      // POST  /orders/:id/resolve-item  — item ID must be in body
      const itemId = params.itemId || input.item_id;
      if (!itemId) {
        res.status(400).json({ success: false, error: 'item_id is required' });
        return;
      }
      const order = await orderService.resolveUnavailableItem(params.id, itemId, input.item_status, {
        id: req.user!.id,
        role: req.user!.role,
      });
      res.status(200).json({
        success: true,
        data: { order },
      });
    } catch (err) {
      next(err);
    }
  }

  async assignRiderAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = orderItemParamsSchema.parse(req.params);
      const input = adminAssignRiderSchema.parse(req.body);
      const delivery = await orderService.assignRiderAdmin(id, input.rider_id, {
        id: req.user!.id,
        role: req.user!.role,
      });
      res.status(200).json({
        success: true,
        data: { delivery },
      });
    } catch (err) {
      next(err);
    }
  }
}

export const orderController = new OrderController();
