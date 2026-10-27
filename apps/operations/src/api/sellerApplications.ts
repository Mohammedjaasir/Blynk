import { ApiError, apiRequest } from './client';
import { errorMessage } from '../lib/errors';
import type { SellerApplication, SellerApplicationStatus } from '../lib/sellerApplications';

/**
 * Seller applications (migration 064; owner's brother, 2026-10-27): the form at blynk.lk/seller.
 * The same staff endpoints Admin uses (ADMIN and OPERATIONS may call them). Both answer 503
 * SELLER_APPLICATIONS_NOT_READY until migration 064 has been run in Coolify.
 */
export interface SellerApplicationList {
  applications: SellerApplication[];
  /** Applications still NEW, whatever the filter (the badge). */
  new_count: number;
}

export const sellerApplications = {
  /** NEW first, then newest first. */
  list: (params: { status?: SellerApplicationStatus } = {}) =>
    apiRequest<Partial<SellerApplicationList>>(`/admin/seller-applications${params.status ? `?status=${params.status}` : ''}`).then(
      (d): SellerApplicationList => ({ applications: d.applications ?? [], new_count: d.new_count ?? 0 }),
    ),
  /** Sets the status and / or the staff note (null or '' clears the note); records who handled it. */
  update: (id: string, body: { status?: SellerApplicationStatus; staff_note?: string | null }) =>
    apiRequest<{ application: SellerApplication; new_count: number }>(`/admin/seller-applications/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { ...body },
    }),
};

/** "Not switched on yet: run database migration 064 in Coolify first." for a 503; else the usual words. */
export function applicationsErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError && err.code === 'SELLER_APPLICATIONS_NOT_READY') {
    return 'Not switched on yet: run database migration 064 in Coolify first.';
  }
  return errorMessage(err, fallback);
}
