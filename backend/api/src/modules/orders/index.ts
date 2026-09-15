import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { orderController } from './order.controller.js';

export const ordersRouter = Router();

// Customer order routes (Guarded by requireAuth)
ordersRouter.post('/', requireAuth, orderController.createOrder.bind(orderController));
ordersRouter.get('/', requireAuth, orderController.getCustomerOrders.bind(orderController));
ordersRouter.get('/:id', requireAuth, orderController.getCustomerOrderById.bind(orderController));
ordersRouter.post('/:id/cancel', requireAuth, orderController.cancelOrder.bind(orderController));

export * from './order.schema.js';
export * from './order.repository.js';
export * from './order.service.js';
export * from './order.controller.js';
