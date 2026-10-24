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
  waiveDeliveryFeeSchema,
} from './order.schema.js';
import { validateCouponSchema } from '../coupons/coupon.schema.js';
import { z } from 'zod';

/** GET /orders/checkout-info?address_id= (owner, 2026-10-10). */
const checkoutInfoQuerySchema = z.object({
  address_id: z.string().uuid('address_id must be a valid UUID').optional(),
  /**
   * Free delivery above a basket amount (owner, 2026-10-12): the cart's item
   * subtotal, so the answer says whether it reaches the amount. Advisory -
   * order placement re-prices the cart and decides again.
   */
  subtotal: z.coerce
    .number({ invalid_type_error: 'subtotal must be a number' })
    .finite()
    .min(0, 'subtotal cannot be negative')
    .max(10_000_000, 'subtotal is too large')
    .optional(),
});
import { availableSlots } from '../configuration/store-schedule.js';
import { leadFromQuery, leadQuerySchema } from './lead-time.js';

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
      const { address_id, subtotal } = checkoutInfoQuerySchema.parse(req.query);
      // Migration 045: ?product_ids=a,b (or ?lead_days=N) -> delivery_lead.
      const leadQuery = leadQuerySchema.parse(req.query);
      const lead = await leadFromQuery(leadQuery);
      // Owner, 2026-10-24: the same product ids give the cart's pickup points for the fee.
      res.status(200).json({
        success: true,
        data: await orderService.getCheckoutInfo(req.user!.id, address_id, subtotal, lead, leadQuery.product_ids),
      });
    } catch (err) {
      next(err);
    }
  }

  /** GET /orders/slots (owner, 2026-10-10): delivery slots the customer may pick. */
  async getDeliverySlots(req: Request, res: Response, next: NextFunction) {
    try {
      // Migration 045 (owner, 2026-10-14): ?product_ids=a,b (or ?lead_days=N)
      // limits the slots to days on/after today + the cart's lead time.
      const lead = await leadFromQuery(leadQuerySchema.parse(req.query));
      res.status(200).json({ success: true, data: await availableSlots(undefined, lead.lead_days) });
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

  /** POST /admin/orders/:id/waive-delivery-fee - "Make delivery free" (owner, 2026-10-21). */
  async waiveDeliveryFeeAdmin(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = orderItemParamsSchema.parse(req.params);
      const input = waiveDeliveryFeeSchema.parse(req.body ?? {});
      const order = await orderService.waiveDeliveryFee(id, input.reason, {
        actorId: req.user!.id,
        ipAddress: req.ip ?? null,
        userAgent: req.get('user-agent') ?? null,
      });
      res.status(200).json({ success: true, data: { order } });
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
