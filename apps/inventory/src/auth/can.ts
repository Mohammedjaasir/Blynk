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
  | 'markPacked' // PATCH /admin/orders/:id/status {status:'PACKED'} (pack only - never cancel or deliver here)
  | 'adjustStock' // POST /admin/inventory/:productId/adjust (restock, write-off, audit count)
  | 'changeTrackingMode' // PATCH /admin/inventory/:productId/mode
  | 'editThreshold' // PATCH /admin/inventory/:productId/threshold (backend also allows OPERATIONS, who can't sign in here)
  | 'manageSuppliers'; // POST/PATCH /admin/suppliers

const RULES: Record<Action, Role[]> = {
  viewStock: ['ADMIN', 'PACKING_STAFF'],
  viewLedger: ['ADMIN', 'PACKING_STAFF'],
  viewSourcing: ['ADMIN', 'PACKING_STAFF'],
  viewSuppliers: ['ADMIN', 'PACKING_STAFF'],
  source: ['ADMIN', 'PACKING_STAFF'],
  markUnavailable: ['ADMIN', 'PACKING_STAFF'],
  markPacked: ['ADMIN', 'PACKING_STAFF'],
  // Owner decision: packing staff receive stock too (restock, write-off, count).
  adjustStock: ['ADMIN', 'PACKING_STAFF'],
  changeTrackingMode: ['ADMIN'],
  editThreshold: ['ADMIN'],
  manageSuppliers: ['ADMIN'],
};

/**
 * Roles that may sign in to Inventory at all. OPERATIONS (backend migration
 * 014) is deliberately absent: those accounts open only the Operations app.
 */
export const INVENTORY_ROLES: Role[] = ['ADMIN', 'PACKING_STAFF'];

export function can(role: Role | undefined | null, action: Action): boolean {
  return !!role && RULES[action].includes(role);
}

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  PACKING_STAFF: 'Packing staff',
  RIDER: 'Rider',
  CUSTOMER: 'Customer',
  OPERATIONS: 'Operations',
};
