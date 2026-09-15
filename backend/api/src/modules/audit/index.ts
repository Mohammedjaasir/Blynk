import { Router } from 'express';

export const auditRouter = Router();

auditRouter.get('/status', (_req, res) => {
  res.json({ module: 'audit', status: 'ready' });
});
