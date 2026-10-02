import { Router } from 'express';
import { notificationService } from './notification.service.js';
import { PushProvider } from './push/push.provider.js';

export * from './notification.provider.js';
export * from './notification.templates.js';
export * from './notification.repository.js';
export * from './notification.service.js';
export * from './notification.worker.js';
export * from './providers/sms.provider.js';
export * from './providers/whatsapp.provider.js';
export * from './push/index.js';

// Phase 6: the outbox's PUSH channel (FCM), a no-op until a Firebase key is
// configured. Registered here rather than in NotificationService's
// constructor, which stays as committed (tests/dental-notifications.test.ts).
notificationService.registerProvider(new PushProvider());

export const notificationsRouter = Router();

notificationsRouter.get('/status', (_req, res) => {
  res.json({ module: 'notifications', status: 'ready' });
});

