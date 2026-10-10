import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles, requireShopper } from '../../middleware/role.middleware.js';
import { customerUsuals } from '../usuals/usuals.service.js';
import { applyReferralCode, listReferrals, referralOverview, referralSettings } from '../referrals/referral.service.js';
import { applyReferralSchema, updateReferralProgramSchema } from '../referrals/referral.rules.js';
import { adjustPointsSchema, updatePointsProgramSchema } from './points.rules.js';
import { adjustPoints, adminCustomerPoints, customerPoints, pointsSettings } from './points.service.js';

/**
 * Your usuals, refer a friend and Blynk Points (owner, 2026-10-10;
 * migration 037).
 *
 * Customer (mounted under /me; shoppers = customers and staff shopping with
 * their own number):
 *   GET  /me/usuals            - the last not-cancelled order's products
 *   GET  /me/referral          - my code, the reward, my invites
 *   POST /me/referral/apply    - a new customer enters a friend's code
 *   GET  /me/points            - balance, value, program numbers, history
 *
 * Admin and Operations (mounted under /admin):
 *   GET/PATCH /admin/settings/referrals
 *   GET       /admin/referrals?status=&page=&limit=
 *   GET/PATCH /admin/settings/points
 *   GET       /admin/customers/:id/points
 *   POST      /admin/customers/:id/points/adjust   {points: +/-int, reason}
 */
export const rewardsMeRouter = Router();
rewardsMeRouter.use(['/usuals', '/referral', '/points'], requireAuth, requireShopper());

rewardsMeRouter.get('/usuals', async (req, res, next) => {
  try {
    res.json({ success: true, data: await customerUsuals(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

rewardsMeRouter.get('/referral', async (req, res, next) => {
  try {
    res.json({ success: true, data: await referralOverview(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

rewardsMeRouter.post('/referral/apply', async (req, res, next) => {
  try {
    const { code } = applyReferralSchema.parse(req.body);
    res.status(201).json({ success: true, data: await applyReferralCode(req.user!.id, code) });
  } catch (err) {
    next(err);
  }
});

rewardsMeRouter.get('/points', async (req, res, next) => {
  try {
    res.json({ success: true, data: await customerPoints(req.user!.id) });
  } catch (err) {
    next(err);
  }
});

// ----------------------------------------------------------------------------
const STAFF = requireRoles(['ADMIN', 'OPERATIONS']);
const actorOf = (req: Request) => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const adminRewardsRouter = Router();

adminRewardsRouter.get('/settings/referrals', requireAuth, STAFF, async (_req, res, next) => {
  try {
    const { setting, updated_at } = await referralSettings.view();
    res.json({ success: true, data: { ...setting, updated_at } });
  } catch (err) {
    next(err);
  }
});

adminRewardsRouter.patch('/settings/referrals', requireAuth, STAFF, async (req, res, next) => {
  try {
    const input = updateReferralProgramSchema.parse(req.body);
    res.json({ success: true, data: await referralSettings.update(input, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

const referralListSchema = z.object({
  status: z.enum(['PENDING', 'REWARDED', 'CAPPED', 'NO_REWARD']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

adminRewardsRouter.get('/referrals', requireAuth, STAFF, async (req, res, next) => {
  try {
    res.json({ success: true, data: await listReferrals(referralListSchema.parse(req.query)) });
  } catch (err) {
    next(err);
  }
});

adminRewardsRouter.get('/settings/points', requireAuth, STAFF, async (_req, res, next) => {
  try {
    const { setting, updated_at } = await pointsSettings.view();
    res.json({ success: true, data: { ...setting, updated_at } });
  } catch (err) {
    next(err);
  }
});

adminRewardsRouter.patch('/settings/points', requireAuth, STAFF, async (req, res, next) => {
  try {
    const input = updatePointsProgramSchema.parse(req.body);
    res.json({ success: true, data: await pointsSettings.update(input, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

const customerIdSchema = z.string().uuid('Invalid customer id');

adminRewardsRouter.get('/customers/:id/points', requireAuth, STAFF, async (req, res, next) => {
  try {
    res.json({ success: true, data: await adminCustomerPoints(customerIdSchema.parse(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

adminRewardsRouter.post('/customers/:id/points/adjust', requireAuth, STAFF, async (req, res, next) => {
  try {
    const id = customerIdSchema.parse(req.params.id);
    const { points, reason } = adjustPointsSchema.parse(req.body);
    res.json({ success: true, data: await adjustPoints(id, points, reason, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

export * from './points.rules.js';
export * from './points.service.js';
export * from './order-rewards.js';
