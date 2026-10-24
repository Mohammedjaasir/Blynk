import { Request, Response, NextFunction } from 'express';
import { authService, sellerSignupClosed } from './auth.service.js';
import { AppError } from '../../middleware/error.middleware.js';
import { clientIp as clientIpOf } from '../../utils/client-ip.js';

export async function requestOtpController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientIp = clientIpOf(req) ?? 'unknown';
    const result = await authService.requestOtp(req.body.phone, clientIp);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function verifyOtpController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientIp = clientIpOf(req) ?? undefined;
    const deviceInfo = req.headers['user-agent'] || undefined;

    const result = await authService.verifyOtp(req.body.phone, req.body.otp, {
      ipAddress: clientIp,
      deviceInfo,
      createAccount: req.body.create_account !== false,
      app: req.body.app,
      shopName: req.body.shop_name,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function refreshTokensController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientIp = clientIpOf(req) ?? undefined;
    const deviceInfo = req.headers['user-agent'] || undefined;

    const result = await authService.refreshTokens(req.body.refresh_token, {
      ipAddress: clientIp,
      deviceInfo,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function logoutController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const refreshToken = req.body?.refresh_token;
    const userId = req.user?.id;

    const result = await authService.logout(refreshToken, userId);

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
}

export async function getCurrentUserController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user?.id) {
      throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    }

    const profile = await authService.getCurrentUser(req.user.id);

    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /auth/seller/register-email: closed (owner, 2026-10-24: sellers are invite-only - Blynk staff
 * add each shop with POST /admin/sellers). Always 403 SELLER_SIGNUP_CLOSED, whatever the body;
 * sellers who already have an email + password keep signing in with /auth/seller/login-email.
 */
export async function sellerRegisterEmailController(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  next(sellerSignupClosed());
}

/** POST /auth/seller/login-email: a SELLER with a password signs in. */
export async function sellerLoginEmailController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await authService.loginSellerWithEmail(req.body.email, req.body.password, {
      ipAddress: clientIpOf(req) ?? undefined,
      deviceInfo: req.headers['user-agent'] || undefined,
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

export async function staffLoginController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientIp = clientIpOf(req) ?? undefined;
    const deviceInfo = req.headers['user-agent'] || undefined;
    const result = await authService.loginWithPassword(req.body.email, req.body.password, {
      ipAddress: clientIp,
      deviceInfo,
    });
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}
