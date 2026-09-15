import { Request, Response, NextFunction } from 'express';
import { AppError } from './error.middleware.js';
import { UserRole } from '../database/types.js';

/**
 * Role-based access control (RBAC) guard middleware.
 * Ensures the authenticated user possesses one of the permitted roles.
 */
export function requireRoles(...roles: (UserRole | UserRole[])[]) {
  const allowedRoles = roles.flat();
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required prior to role verification', 401, 'UNAUTHORIZED'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(
          `Forbidden: Role '${req.user.role}' is not authorized to access this resource`,
          403,
          'FORBIDDEN'
        )
      );
    }

    next();
  };
}
