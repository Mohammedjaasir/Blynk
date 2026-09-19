import { Router } from 'express';

export const inventoryRouter = Router();

inventoryRouter.get('/status', (_req, res) => {
  res.json({ module: 'inventory', status: 'ready' });
});

export * from './inventory.schema.js';
export * from './inventory.repository.js';
export * from './inventory.service.js';
export * from './inventory.controller.js';
