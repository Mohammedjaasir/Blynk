import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service.js';
import { AppError } from '../../middleware/error.middleware.js';

export async function requestOtpController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
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
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || undefined;
    const deviceInfo = req.headers['user-agent'] || undefined;

    const result = await authService.verifyOtp(req.body.phone, req.body.otp, {
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

export async function refreshTokensController(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const clientIp = req.ip || (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || undefined;
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
