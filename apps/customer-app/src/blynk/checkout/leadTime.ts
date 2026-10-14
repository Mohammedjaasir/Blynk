import { lineAvailable, type CartLine, type ComboLine } from '@/blynk/cart/cartStore';
import { dayLabel, earliestDeliveryDate, leadDaysOf, colomboDayPlus } from '@/blynk/catalog/variants';
import type { CheckoutInfo } from '@/blynk/orders/types';
import { availableSlot, canOrderNow, type DeliverySlots } from './slots';

/*
 * Delivery lead time at checkout (migration 045, owner 2026-10-14: "items that can only be
 * delivered after two days or some days"). A cart holding such an item cannot go "as soon as
 * possible": the customer picks a slot on or after its first delivery day. With scheduled
 * delivery switched off the cart cannot be ordered until that item is removed. The server
 * decides again at POST /orders (LEAD_TIME_REQUIRES_SLOT / SLOT_BEFORE_LEAD_TIME).
 */

export const LEAD_COPY = {
  title: 'Delivery date',
  /** "Ribbon Cake needs 2 days. The earliest delivery is Fri 17 Oct." */
  needs: (name: string | null, days: number, date: string | null) =>
    `${name ?? 'An item in your cart'} needs ${days} ${days === 1 ? 'day' : 'days'}.${date ? ` The earliest delivery is ${date}.` : ''}`,
  pickSlot: (date: string | null) => (date ? `Pick a delivery time from ${date}.` : 'Pick a delivery time.'),
  slotsOff: 'Scheduled delivery is not available right now, so this cart cannot be delivered. Remove the item to order now.',
  slotNote: (date: string | null) => (date ? `Delivered from ${date}. Pick a time below.` : 'Pick a delivery time below.'),
  pickCta: 'Pick a delivery time',
  blockedCta: 'Remove the item to order now',
} as const;

/** What the cart's lead time is, from the cart itself (items and combo packs). */
export interface CartLead {
  /** The longest lead time in the cart, in whole days (0 = same day). */
  days: number;
  /** The product (or combo pack) that needs it, for the message. */
  name: string | null;
}

/** The cart's longest lead time: available product lines and combo packs (their own delivery_lead_days). */
export function cartLead(lines: readonly CartLine[], combos: readonly ComboLine[] = []): CartLead {
  let best: CartLead = { days: 0, name: null };
  for (const l of lines) {
    if (!lineAvailable(l)) continue;
    const d = leadDaysOf(l.product);
    if (d > best.days) best = { days: d, name: l.product.name };
  }
  for (const c of combos) {
    if (!c.combo.is_available) continue;
    const d = leadDaysOf(c.combo);
    if (d > best.days) best = { days: d, name: c.combo.name };
  }
  return best;
}

/** The product ids GET /orders/slots and checkout-info take (the cart's products, combo items included). */
export function cartProductIds(lines: readonly CartLine[], combos: readonly ComboLine[] = []): string[] {
  const ids = new Set<string>();
  for (const l of lines) if (lineAvailable(l)) ids.add(l.product.id);
  for (const c of combos) if (c.combo.is_available) for (const it of c.combo.items) ids.add(it.product_id);
  return [...ids].filter((id) => !id.startsWith('demo-')).sort();
}

export interface LeadState {
  days: number;
  name: string | null;
  /** YYYY-MM-DD of the first delivery day (null for same day). */
  date: string | null;
  /** "Fri 17 Oct". */
  dateLabel: string | null;
  /** "As soon as possible" is not possible for this cart. */
  asapAllowed: boolean;
  /** Lead time and scheduled delivery switched off: the cart cannot be ordered as it is. */
  blocked: boolean;
}

/**
 * The cart's lead time, the largest of what the cart says and what the server said (slots answer
 * or checkout-info delivery_lead), so an older catalogue copy can't let ASAP through.
 */
export function leadState(args: {
  cart: CartLead; slots: DeliverySlots | null; quote: Pick<CheckoutInfo, 'delivery_lead'> | null; now?: Date;
}): LeadState {
  const { cart, slots, quote } = args;
  const now = args.now ?? new Date();
  const fromSlots = slots?.lead_days ?? 0;
  const fromQuote = quote?.delivery_lead?.lead_days ?? 0;
  const days = Math.max(cart.days, fromSlots, fromQuote);
  if (days === 0) return { days: 0, name: null, date: null, dateLabel: null, asapAllowed: true, blocked: false };
  const serverDate = (fromSlots === days ? slots?.earliest_delivery_date : null) ?? (fromQuote === days ? quote?.delivery_lead?.earliest_delivery_date : null) ?? null;
  const date = dayLabel(serverDate) ? (serverDate as string) : earliestDeliveryDate({ delivery_lead_days: days }, now) ?? colomboDayPlus(days, now);
  return {
    days,
    name: cart.days === days ? cart.name : null,
    date,
    dateLabel: dayLabel(date),
    asapAllowed: false,
    // slots answered and are off: nothing can be booked
    blocked: !!slots && !slots.enabled,
  };
}

/**
 * Place order may go: without a lead time the usual rule (open for ASAP, or a slot with room);
 * with one, only a picked slot that is still offered (and never while slots are off).
 */
export function canOrderWithLead(args: { storeOpen: boolean; slots: DeliverySlots | null; picked: string | null; lead: LeadState }): boolean {
  if (args.lead.days === 0) return canOrderNow(args);
  if (args.lead.blocked || !args.slots?.enabled) return false;
  return !!availableSlot(args.slots, args.picked);
}

/** Slots on or after the first delivery day (the server already filters; this guards an older one). */
export function slotsFromLead(slots: DeliverySlots | null, lead: LeadState): DeliverySlots | null {
  if (!slots || lead.days === 0 || !lead.date) return slots;
  const from = lead.date;
  // a slot's day in Colombo: its start shifted by +5:30
  const dayOf = (iso: string) => new Date(Date.parse(iso) + 330 * 60_000).toISOString().slice(0, 10);
  return { ...slots, asap_available: false, slots: slots.slots.filter((s) => dayOf(s.start) >= from) };
}
