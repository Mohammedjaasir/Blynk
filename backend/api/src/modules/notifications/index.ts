import { Router } from 'express';

export * from './notification.provider.js';
export * from './notification.templates.js';
export * from './notification.repository.js';
export * from './notification.service.js';
export * from './notification.worker.js';
export * from './providers/sms.provider.js';
export * from './providers/whatsapp.provider.js';

export const notificationsRouter = Router();

notificationsRouter.get('/status', (_req, res) => {
  res.json({ module: 'notifications', status: 'ready' });
});

