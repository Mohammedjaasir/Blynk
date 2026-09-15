import { Request, Response, NextFunction } from 'express';
import { orderService } from './order.service.js';
import { createOrderSchema, cancelOrderSchema, orderQuerySchema } from './order.schema.js';
import { OrderStatus, ItemFulfillmentStatus } from '../../database/types.js';

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
      const order = await orderService.getCustomerOrderById(req.params.id as string, req.user!.id);
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
      const input = cancelOrderSchema.parse(req.body);
      const order = await orderService.cancelOrderCustomer(
        req.params.id as string,
        req.user!.id,
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
      const status = req.query.status as OrderStatus | undefined;
      const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

      const result = await orderService.getAdminOrders({ status, page, limit });
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
      const order = await orderService.getAdminOrderById(req.params.id as string);
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
      const { status, notes } = req.body;
      const order = await orderService.updateOrderStatusAdmin(
        req.params.id as string,
        status as OrderStatus,
        req.user!.id,
        notes
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
      const itemStatus = (req.body.item_status || 'UNAVAILABLE') as ItemFulfillmentStatus;
      const order = await orderService.resolveUnavailableItem(
        req.params.id as string,
        req.params.itemId as string,
        itemStatus
      );
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
      const { rider_id } = req.body;
      const delivery = await orderService.assignRiderAdmin(req.params.id as string, rider_id);
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
