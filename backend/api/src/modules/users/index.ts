import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { addressController } from './address.controller.js';

// ----------------------------------------------------------------------------
// 1. CUSTOMER ME & ADDRESS BOOK ROUTER (/api/v1/me)
// ----------------------------------------------------------------------------
export const meRouter = Router();

meRouter.use(requireAuth);

meRouter.get('/', addressController.getProfile.bind(addressController));
meRouter.patch('/', addressController.updateProfile.bind(addressController));

meRouter.get('/addresses', addressController.listAddresses.bind(addressController));
meRouter.post('/addresses', addressController.createAddress.bind(addressController));
meRouter.get('/addresses/:id', addressController.getAddressById.bind(addressController));
meRouter.patch('/addresses/:id', addressController.updateAddress.bind(addressController));
meRouter.delete('/addresses/:id', addressController.deleteAddress.bind(addressController));
meRouter.post('/addresses/:id/default', addressController.setDefaultAddress.bind(addressController));

// ----------------------------------------------------------------------------
// 2. USERS MODULE ROUTER (/api/v1/users)
// ----------------------------------------------------------------------------
export const usersRouter = Router();

usersRouter.get('/status', (_req, res) => {
  res.json({ module: 'users', status: 'ready' });
});

export * from './address.schema.js';
export * from './address.repository.js';
export * from './address.service.js';
export * from './address.controller.js';
