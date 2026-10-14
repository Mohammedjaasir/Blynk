import { Router, type Request } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { requireRoles, requireShopper } from '../../middleware/role.middleware.js';
import { logger } from '../../utils/logger.js';
import { paymentGatewayService, testHashSchema, updatePaymentGatewaySchema } from './gateway-settings.js';
import { checkoutRequestSchema, payhereService } from './payhere.service.js';

/**
 * Payments (migration 047; owner, 2026-10-14): PayHere online payments.
 * Contract: docs/api/payhere.md.
 */
export const paymentsRouter = Router();

paymentsRouter.get('/status', (_req, res) => {
  res.json({ module: 'payments', status: 'ready' });
});

// The order's owner gets the PayHere form fields (hash computed here; the
// merchant secret never leaves the server).
paymentsRouter.post('/payhere/checkout', requireAuth, requireShopper(), async (req, res, next) => {
  try {
    const { order_id } = checkoutRequestSchema.parse(req.body);
    res.json({ success: true, data: await payhereService.checkout(req.user!.id, order_id) });
  } catch (err) {
    next(err);
  }
});

// Called by PayHere (server to server, x-www-form-urlencoded). Public: the
// md5sig, computed with our merchant secret, is the authentication.
paymentsRouter.post('/payhere/notify', async (req, res) => {
  try {
    const { verified } = await payhereService.handleNotify(req.body);
    res.status(verified ? 200 : 400).type('text/plain').send(verified ? 'OK' : 'REJECTED');
  } catch (err) {
    // 500 makes PayHere retry later; never echo details.
    logger.error({ err }, 'PayHere notification failed');
    res.status(500).type('text/plain').send('ERROR');
  }
});

// ----------------------------------------------------------------------------
// Staff settings (mounted under /admin): ADMIN and OPERATIONS; credentials
// ADMIN only (enforced in the service).
// ----------------------------------------------------------------------------
const actorOf = (req: Request) => ({
  actorId: req.user!.id,
  role: req.user!.role,
  ipAddress: req.ip ?? null,
  userAgent: req.get('user-agent') ?? null,
});

export const adminPaymentGatewayRouter = Router();

adminPaymentGatewayRouter.get(
  '/settings/payment-gateway',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      res.json({ success: true, data: await paymentGatewayService.get(req.user!.role) });
    } catch (err) {
      next(err);
    }
  }
);

adminPaymentGatewayRouter.patch(
  '/settings/payment-gateway',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = updatePaymentGatewaySchema.parse(req.body);
      res.json({ success: true, data: await paymentGatewayService.update(input, actorOf(req)) });
    } catch (err) {
      next(err);
    }
  }
);

adminPaymentGatewayRouter.post(
  '/settings/payment-gateway/test-hash',
  requireAuth,
  requireRoles(['ADMIN', 'OPERATIONS']),
  async (req, res, next) => {
    try {
      const input = testHashSchema.parse(req.body ?? {});
      res.json({ success: true, data: await paymentGatewayService.testHash(input) });
    } catch (err) {
      next(err);
    }
  }
);
