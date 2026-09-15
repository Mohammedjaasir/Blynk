import { Router } from 'express';

export const deliveriesRouter = Router();

deliveriesRouter.get('/status', (_req, res) => {
  res.json({ module: 'deliveries', status: 'ready' });
});
