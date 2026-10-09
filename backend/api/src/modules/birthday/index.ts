import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles } from '../../middleware/role.middleware.js';
import { listBirthdays, MAX_BIRTHDAY_LIST_DAYS } from './birthday.list.js';

/**
 * Birthdays (owner, 2026-10-09; migration 034), mounted under /admin:
 * GET /admin/birthdays?days=7 - ADMIN and OPERATIONS.
 */
export const adminBirthdaysRouter = Router();

const querySchema = z.object({
  days: z.coerce
    .number({ invalid_type_error: 'days must be a number' })
    .int('days must be a whole number')
    .min(0, 'days cannot be negative')
    .max(MAX_BIRTHDAY_LIST_DAYS, `days can be at most ${MAX_BIRTHDAY_LIST_DAYS}`)
    .default(7),
});

adminBirthdaysRouter.get('/birthdays', requireAuth, requireRoles(['ADMIN', 'OPERATIONS']), async (req, res, next) => {
  try {
    const { days } = querySchema.parse(req.query);
    res.json({ success: true, data: await listBirthdays({ days }) });
  } catch (err) {
    next(err);
  }
});

export * from './birthday.rules.js';
export * from './birthday.offer.js';
export * from './birthday.sms.js';
export * from './birthday.list.js';
