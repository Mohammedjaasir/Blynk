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

/**
 * Accounts that may also shop (owner, 2026-10-07): one phone number is one
 * account, and a rider or Operations person keeps using the customer app
 * with it. Every shopping route still acts only on the caller's own orders,
 * addresses and bookings. Admin and Inventory have no phone, so never shop.
 */
export const SHOPPER_ROLES: UserRole[] = ['CUSTOMER', 'RIDER', 'OPERATIONS'];
export const requireShopper = () => requireRoles(SHOPPER_ROLES);
