import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware.js';
import { UserRole } from '../database/types.js';
import { verifyAccessToken } from '../modules/auth/token.service.js';

export interface AuthUser {
  id: string;
  phone: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Authentication middleware.
 * Validates presence, format, and cryptographic validity of Bearer JWT token.
 * Populates req.user with verified { id, phone, role }.
 */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new AppError(
        'Missing or malformed Authorization header. Expected Bearer token.',
        401,
        'UNAUTHORIZED'
      )
    );
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return next(new AppError('Missing or empty Bearer token.', 401, 'UNAUTHORIZED'));
  }

  try {
    const user = verifyAccessToken(token);
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
