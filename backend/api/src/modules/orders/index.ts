import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { orderController } from './order.controller.js';
import { streamOrderLocation } from './order.location.controller.js';

export const ordersRouter = Router();

// Customer order routes (Guarded by requireAuth)
// Placing an order is for customer accounts only; a staff token gets 403.
ordersRouter.post('/', requireAuth, requireRoles('CUSTOMER'), orderController.createOrder.bind(orderController));
// Coupon preview at checkout (migration 018); order creation re-validates.
ordersRouter.post('/validate-coupon', requireAuth, requireRoles('CUSTOMER'), orderController.validateCoupon.bind(orderController));
ordersRouter.get('/', requireAuth, orderController.getCustomerOrders.bind(orderController));
ordersRouter.get('/:id', requireAuth, orderController.getCustomerOrderById.bind(orderController));
ordersRouter.post('/:id/cancel', requireAuth, orderController.cancelOrder.bind(orderController));
ordersRouter.get('/:id/location/stream', requireAuth, requireRoles('CUSTOMER'), streamOrderLocation);

export * from './order.schema.js';
export * from './order.repository.js';
export * from './order.service.js';
export * from './order.controller.js';
export * from './order.location.controller.js';
