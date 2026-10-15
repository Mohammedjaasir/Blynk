import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles, requireShopper } from '../../middleware/role.middleware.js';
import { adjustWalletSchema, orderWalletRefundSchema, updateWalletSettingSchema, walletPageSchema } from './wallet.rules.js';
import { adjustWallet, adminCustomerWallet, adminOrderWallet, customerWallet, refundOrderToWallet, walletSettings } from './wallet.service.js';

/**
 * Blynk Wallet (owner, 2026-10-15; migration 049). Contract: docs/api/wallet.md.
 *
 * Customer (mounted under /me; shoppers):
 *   GET  /me/wallet?page=&limit=
 *
 * Staff (mounted under /admin):
 *   GET/PATCH /admin/settings/wallet                  ADMIN, OPERATIONS
 *   GET       /admin/customers/:id/wallet             ADMIN, OPERATIONS
 *   POST      /admin/customers/:id/wallet/adjust      ADMIN only
 *   GET       /admin/orders/:id/wallet                ADMIN, OPERATIONS
 *   POST      /admin/orders/:id/wallet-refund         ADMIN, OPERATIONS
 */
export const walletMeRouter = Router();
walletMeRouter.use('/wallet', requireAuth, requireShopper());

walletMeRouter.get('/wallet', async (req, res, next) => {
  try {
    const { page, limit } = walletPageSchema.parse(req.query);
    res.json({ success: true, data: await customerWallet(req.user!.id, page, limit) });
  } catch (err) {
    next(err);
  }
});

const STAFF = requireRoles(['ADMIN', 'OPERATIONS']);
const ADMIN_ONLY = requireRoles(['ADMIN']);
const actorOf = (req: Request) => ({
  actorId: req.user!.id,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});
const idSchema = (what: string) => z.string().uuid(`Invalid ${what} id`);

export const adminWalletRouter = Router();

adminWalletRouter.get('/settings/wallet', requireAuth, STAFF, async (_req, res, next) => {
  try {
    const { setting, updated_at } = await walletSettings.view();
    res.json({ success: true, data: { ...setting, updated_at } });
  } catch (err) {
    next(err);
  }
});

adminWalletRouter.patch('/settings/wallet', requireAuth, STAFF, async (req, res, next) => {
  try {
    const input = updateWalletSettingSchema.parse(req.body);
    res.json({ success: true, data: await walletSettings.update(input, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

adminWalletRouter.get('/customers/:id/wallet', requireAuth, STAFF, async (req, res, next) => {
  try {
    const id = idSchema('customer').parse(req.params.id);
    const { page, limit } = walletPageSchema.extend({ limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(req.query);
    res.json({ success: true, data: await adminCustomerWallet(id, page, limit) });
  } catch (err) {
    next(err);
  }
});

adminWalletRouter.post('/customers/:id/wallet/adjust', requireAuth, ADMIN_ONLY, async (req, res, next) => {
  try {
    const id = idSchema('customer').parse(req.params.id);
    const { amount, reason } = adjustWalletSchema.parse(req.body);
    res.json({ success: true, data: await adjustWallet(id, amount, reason, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

adminWalletRouter.get('/orders/:id/wallet', requireAuth, STAFF, async (req, res, next) => {
  try {
    res.json({ success: true, data: await adminOrderWallet(idSchema('order').parse(req.params.id)) });
  } catch (err) {
    next(err);
  }
});

adminWalletRouter.post('/orders/:id/wallet-refund', requireAuth, STAFF, async (req, res, next) => {
  try {
    const id = idSchema('order').parse(req.params.id);
    const input = orderWalletRefundSchema.parse(req.body);
    res.status(201).json({ success: true, data: await refundOrderToWallet(id, input, actorOf(req)) });
  } catch (err) {
    next(err);
  }
});

export * from './wallet.rules.js';
export * from './wallet.service.js';
