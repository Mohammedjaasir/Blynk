import type { FreeDeliveryStatus } from '../orders/types';

/*
 * What Home (and the cart bar) may say about free deliveries (owner, 2026-10-14: "Heavy marketing
 * for free delivery, but this account I logged in has ordered multiple times").
 *
 * - Guest: GET /store's new-customer offer, always worded "for new customers".
 * - Signed in: only what GET /orders/checkout-info says for this customer (`free_delivery.remaining`,
 *   counted by the server across the same verified phone number). Until that is known, or when it
 *   cannot be asked (no saved address yet), nothing is claimed - no flash of a wrong promise.
 * Pure: no React, no network.
 */

export type FreeClaim =
  | { kind: 'none'; count: 0 }
  /** Not signed in: the store-wide offer for new customers. */
  | { kind: 'new-customer'; count: number }
  /** Signed in: this customer's free deliveries still left. */
  | { kind: 'personal'; count: number };

export const NO_CLAIM: FreeClaim = { kind: 'none', count: 0 };

export function freeDeliveryClaim(input: {
  /** freeDeliveryCount(GET /store): 0 when Ops has the offer off. */
  storeCount: number;
  signedIn: boolean;
  /** checkout-info free_delivery for this customer; null/undefined = not known (yet). */
  status?: Pick<FreeDeliveryStatus, 'enabled' | 'remaining'> | null;
}): FreeClaim {
  const { storeCount, signedIn, status } = input;
  if (!signedIn) return storeCount > 0 ? { kind: 'new-customer', count: Math.floor(storeCount) } : NO_CLAIM;
  if (!status || !status.enabled) return NO_CLAIM;
  const left = Math.floor(Number(status.remaining));
  return Number.isFinite(left) && left > 0 ? { kind: 'personal', count: left } : NO_CLAIM;
}

const deliveries = (n: number) => `${n} deliver${n === 1 ? 'y' : 'ies'}`;

/** Aisle card / meta line: "First 2 deliveries free for new customers", "Your next 2 deliveries free", "1 free delivery left". */
export function claimLine(c: FreeClaim): string | null {
  if (c.kind === 'new-customer') return c.count === 1 ? 'First delivery free for new customers' : `First ${c.count} deliveries free for new customers`;
  if (c.kind === 'personal') return c.count === 1 ? '1 free delivery left' : `Your next ${c.count} deliveries free`;
  return null;
}

/** The "NO PACKAGING FEE & NO PLATFORM FEE" band's big title, or null (the caller picks a true one). */
export function claimTitle(c: FreeClaim): string | null {
  if (c.kind === 'new-customer') return c.count === 1 ? 'FIRST DELIVERY FREE' : `FIRST ${c.count} DELIVERIES FREE`;
  if (c.kind === 'personal') return c.count === 1 ? '1 FREE DELIVERY LEFT' : `NEXT ${c.count} DELIVERIES FREE`;
  return null;
}

/** The bottom fee strip's third item ([coin, label]), or null (the caller shows the fee instead). */
export function claimFee(c: FreeClaim): [string, string] | null {
  if (c.kind === 'new-customer') return [String(c.count), 'Free · New Users'];
  if (c.kind === 'personal') return [String(c.count), c.count === 1 ? 'Free Delivery Left' : 'Free Left'];
  return null;
}

/** The yellow promo band's first line, or null. */
export function claimPromoLine(c: FreeClaim): string | null {
  if (c.kind === 'new-customer') return `Free delivery on your first ${c.count === 1 ? 'order' : `${c.count} orders`} for new customers`;
  if (c.kind === 'personal') return c.count === 1 ? 'Your next delivery is free' : `Your next ${deliveries(c.count)} are free`;
  return null;
}
