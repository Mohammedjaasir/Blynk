import { Router } from 'express';

export const configurationRouter = Router();

configurationRouter.get('/status', (_req, res) => {
  res.json({ module: 'configuration', status: 'ready' });
});
