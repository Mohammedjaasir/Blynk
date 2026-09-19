import type { Role } from '../api/types';

/**
 * What each role may do in the Inventory app, mirroring the backend guards in
 * backend/api/src/modules/admin/index.ts. This only decides which controls
 * are shown - the API refuses anything a role may not do regardless.
 */
export type Action =
  | 'viewStock'
  | 'viewLedger'
  | 'viewSourcing'
  | 'viewSuppliers'
  | 'source' // POST /admin/orders/:id/items/:itemId/source
  | 'markUnavailable' // POST /admin/orders/:id/resolve-item
  | 'adjustStock' // POST /admin/inventory/:productId/adjust
  | 'changeTrackingMode' // PATCH /admin/inventory/:productId/mode
  | 'manageSuppliers'; // POST/PATCH /admin/suppliers

const RULES: Record<Action, Role[]> = {
  viewStock: ['ADMIN', 'PACKING_STAFF'],
  viewLedger: ['ADMIN', 'PACKING_STAFF'],
  viewSourcing: ['ADMIN', 'PACKING_STAFF'],
  viewSuppliers: ['ADMIN', 'PACKING_STAFF'],
  source: ['ADMIN', 'PACKING_STAFF'],
  markUnavailable: ['ADMIN', 'PACKING_STAFF'],
  adjustStock: ['ADMIN'],
  changeTrackingMode: ['ADMIN'],
  manageSuppliers: ['ADMIN'],
};

/** Roles that may sign in to Inventory at all. */
export const INVENTORY_ROLES: Role[] = ['ADMIN', 'PACKING_STAFF'];

export function can(role: Role | undefined | null, action: Action): boolean {
  return !!role && RULES[action].includes(role);
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  PACKING_STAFF: 'Packing staff',
  RIDER: 'Rider',
  CUSTOMER: 'Customer',
};
