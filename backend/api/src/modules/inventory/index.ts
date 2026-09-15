import { Router } from 'express';

export const inventoryRouter = Router();

inventoryRouter.get('/status', (_req, res) => {
  res.json({ module: 'inventory', status: 'ready' });
});
