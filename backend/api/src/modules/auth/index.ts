import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  logoutSchema,
  staffLoginSchema,
  sellerLoginEmailSchema,
} from './auth.schema.js';
import {
  requestOtpController,
  verifyOtpController,
  refreshTokensController,
  logoutController,
  getCurrentUserController,
  staffLoginController,
  sellerRegisterEmailController,
  sellerLoginEmailController,
} from './auth.controller.js';

export const authRouter = Router();

// Module status / health
authRouter.get('/status', (_req, res) => {
  res.json({ module: 'auth', status: 'ready', stage: 2 });
});

// Authentication endpoints
authRouter.post('/otp/request', validate({ body: requestOtpSchema }), requestOtpController);
authRouter.post('/otp/verify', validate({ body: verifyOtpSchema }), verifyOtpController);
// Staff email + password sign-in (migration 012): ADMIN / PACKING_STAFF / OPERATIONS only.
authRouter.post('/staff/login', validate({ body: staffLoginSchema }), staffLoginController);
// Seller portal email + password (owner, 2026-10-24): SELLER accounts only.
// Sign-up closed (sellers are invite-only, owner 2026-10-24): always 403 SELLER_SIGNUP_CLOSED.
authRouter.post('/seller/register-email', sellerRegisterEmailController);
authRouter.post('/seller/login-email', validate({ body: sellerLoginEmailSchema }), sellerLoginEmailController);
authRouter.post('/refresh', validate({ body: refreshTokenSchema }), refreshTokensController);
authRouter.post('/logout', validate({ body: logoutSchema }), logoutController);

// Authenticated user identity
authRouter.get('/me', requireAuth, getCurrentUserController);
