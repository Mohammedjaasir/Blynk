import { Router } from 'express';

export const paymentsRouter = Router();

paymentsRouter.get('/status', (_req, res) => {
  res.json({ module: 'payments', status: 'ready' });
});
