import { Router } from 'express';

export const notificationsRouter = Router();

notificationsRouter.get('/status', (_req, res) => {
  res.json({ module: 'notifications', status: 'ready' });
});
