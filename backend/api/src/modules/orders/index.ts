import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireShopper } from '../../middleware/role.middleware.js';
import { orderController } from './order.controller.js';
import { streamOrderLocation } from './order.location.controller.js';

export const ordersRouter = Router();

// Customer order routes (Guarded by requireAuth)
// Placing an order: customers, and riders / Operations shopping with their
// own number (SHOPPER_ROLES). Admin and Inventory tokens get 403.
ordersRouter.post('/', requireAuth, requireShopper(), orderController.createOrder.bind(orderController));
// Coupon preview at checkout (migration 018); order creation re-validates.
ordersRouter.post('/validate-coupon', requireAuth, requireShopper(), orderController.validateCoupon.bind(orderController));
// This customer's delivery fee and coupon switch (owner, 2026-10-08); before /:id.
ordersRouter.get('/checkout-info', requireAuth, requireShopper(), orderController.getCheckoutInfo.bind(orderController));
ordersRouter.get('/', requireAuth, orderController.getCustomerOrders.bind(orderController));
ordersRouter.get('/:id', requireAuth, orderController.getCustomerOrderById.bind(orderController));
ordersRouter.post('/:id/cancel', requireAuth, orderController.cancelOrder.bind(orderController));
ordersRouter.get('/:id/location/stream', requireAuth, requireShopper(), streamOrderLocation);

export * from './order.schema.js';
export * from './order.repository.js';
export * from './order.service.js';
export * from './order.controller.js';
export * from './order.location.controller.js';
