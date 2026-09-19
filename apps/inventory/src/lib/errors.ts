import { ApiError } from '../api/client';

/**
 * Operator-facing wording for the backend's error codes. Anything not listed
 * falls back to the API's own message, which is already written for people;
 * a raw exception or "500" is never shown.
 */
const MESSAGES: Record<string, string> = {
  ITEM_ALREADY_SOURCED: 'Already sourced - someone recorded this item first. The queue has been refreshed.',
  ITEM_ALREADY_RESOLVED: 'This item has already been resolved. Refresh the sourcing queue.',
  ORDER_ITEM_NOT_FOUND: 'This item is no longer on this order. Refresh the sourcing queue.',
  INSUFFICIENT_TRACKED_INVENTORY:
    'Not enough counted stock to source this item. Restock it, or mark the item unavailable.',
  CANNOT_SOURCE_UNAVAILABLE_ITEM: 'This item was marked unavailable and can no longer be sourced.',
  ORDER_NOT_IN_SOURCING_STATE: 'This order is cancelled or delivered, so its items can no longer be sourced.',
  SUPPLIER_INACTIVE: 'That supplier has been deactivated. Choose an active supplier.',
  SUPPLIER_CODE_TAKEN: 'Another supplier already uses this code.',
  PRODUCT_NOT_TRACKED: 'Only tracked products can be adjusted. Switch the product to TRACKED first.',
  NEGATIVE_INVENTORY_PROHIBITED: 'That would take stock below zero.',
  INSUFFICIENT_AVAILABLE_INVENTORY: 'That would leave less stock than is already reserved.',
  FORBIDDEN: 'Your account is not allowed to do this.',
  NETWORK: 'Could not reach the Blynk API. Check the connection and try again.',
};

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) {
    if (err.code && MESSAGES[err.code]) return MESSAGES[err.code];
    if (err.status === 403) return MESSAGES.FORBIDDEN;
    if (err.status >= 500) return 'The Blynk API had a problem. Try again in a moment.';
    return err.message || fallback;
  }
  return fallback;
}

export const isApiError = (err: unknown, code: string) => err instanceof ApiError && err.code === code;
export const isForbidden = (err: unknown) => err instanceof ApiError && err.status === 403;
