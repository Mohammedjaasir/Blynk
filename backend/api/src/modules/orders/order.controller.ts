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
import { validateCouponSchema } from '../coupons/coupon.schema.js';
import { z } from 'zod';

/** GET /orders/checkout-info?address_id= (owner, 2026-10-10). */
const checkoutInfoQuerySchema = z.object({ address_id: z.string().uuid('address_id must be a valid UUID').optional() });
import { availableSlots } from '../configuration/store-schedule.js';

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

  async validateCoupon(req: Request, res: Response, next: NextFunction) {
    try {
      const input = validateCouponSchema.parse(req.body);
      const preview = await orderService.previewCoupon(req.user!.id, input);
      res.status(200).json({ success: true, data: { coupon: preview } });
    } catch (err) {
      next(err);
    }
  }

  async getCheckoutInfo(req: Request, res: Response, next: NextFunction) {
    try {
      // Per-km tiers (owner, 2026-10-10): the fee for the cart's chosen address.
      const { address_id } = checkoutInfoQuerySchema.parse(req.query);
      res.status(200).json({ success: true, data: await orderService.getCheckoutInfo(req.user!.id, address_id) });
    } catch (err) {
      next(err);
    }
  }

  /** GET /orders/slots (owner, 2026-10-10): delivery slots the customer may pick. */
  async getDeliverySlots(_req: Request, res: Response, next: NextFunction) {
    try {
      res.status(200).json({ success: true, data: await availableSlots() });
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
      // The customer's own cancel: a rider or Operations person cancelling
      // their own order acts as its customer here. CUSTOMER_CANCEL still
      // refuses any order that is not the caller's (404).
      const order = await orderService.cancelOrderCustomer(
        id,
        { id: req.user!.id, role: 'CUSTOMER' },
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
        input.notes,
        input.delivery_code
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
      const delivery = await orderService.assignRiderAdmin(
        id,
        input.rider_id,
        { id: req.user!.id, role: req.user!.role },
        input.confirm_far_batch === true
      );
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
