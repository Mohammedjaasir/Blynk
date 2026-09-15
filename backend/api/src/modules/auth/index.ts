import { Router } from 'express';
import { validate } from '../../middleware/validate.middleware.js';
import { requireAuth } from '../../middleware/auth.middleware.js';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshTokenSchema,
  logoutSchema,
} from './auth.schema.js';
import {
  requestOtpController,
  verifyOtpController,
  refreshTokensController,
  logoutController,
  getCurrentUserController,
} from './auth.controller.js';

export const authRouter = Router();

// Module status / health
authRouter.get('/status', (_req, res) => {
  res.json({ module: 'auth', status: 'ready', stage: 2 });
});

// Authentication endpoints
authRouter.post('/otp/request', validate({ body: requestOtpSchema }), requestOtpController);
authRouter.post('/otp/verify', validate({ body: verifyOtpSchema }), verifyOtpController);
authRouter.post('/refresh', validate({ body: refreshTokenSchema }), refreshTokensController);
authRouter.post('/logout', validate({ body: logoutSchema }), logoutController);

// Authenticated user identity
authRouter.get('/me', requireAuth, getCurrentUserController);
