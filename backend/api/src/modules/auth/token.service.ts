import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../../config/env.js';
import { UserRole } from '../../database/types.js';
import { AuthUser } from '../../middleware/auth.middleware.js';
import { AppError } from '../../middleware/error.middleware.js';

export interface TokenPayload {
  sub: string;
  phone: string;
  role: UserRole;
}

/**
 * Signs a cryptographically secure JWT access token (HS256).
 */
export function generateAccessToken(user: { id: string; phone: string; role: UserRole }): string {
  const payload: TokenPayload = {
    sub: user.id,
    phone: user.phone,
    role: user.role,
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    expiresIn: env.JWT_ACCESS_EXPIRY as jwt.SignOptions['expiresIn'],
  });
}

/**
 * Validates and decodes a JWT access token.
 * Strictly enforces HS256 algorithm and required claims.
 */
export function verifyAccessToken(token: string): AuthUser {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
    }) as JwtPayload & TokenPayload;

    if (!decoded.sub || !decoded.phone || !decoded.role) {
      throw new AppError('Invalid token claims structure.', 401, 'INVALID_TOKEN');
    }

    return {
      id: decoded.sub,
      phone: decoded.phone,
      role: decoded.role,
    };
  } catch (err: unknown) {
    if (err instanceof AppError) {
      throw err;
    }
    if (err instanceof jwt.TokenExpiredError) {
      throw new AppError('Access token has expired.', 401, 'TOKEN_EXPIRED');
    }
    if (err instanceof jwt.JsonWebTokenError) {
      throw new AppError('Invalid access token.', 401, 'INVALID_TOKEN');
    }
    throw new AppError('Authentication failed.', 401, 'UNAUTHORIZED');
  }
}

/**
 * Generates a high-entropy random refresh token and its SHA-256 digest.
 * Raw token is sent to the client; only the digest is stored in the database.
 */
export function generateRefreshToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(rawToken);
  return { rawToken, tokenHash };
}

/**
 * Computes a SHA-256 digest of a raw token string for secure at-rest storage and constant-time lookup.
 */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}
