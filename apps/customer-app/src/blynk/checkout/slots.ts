/*
 * Scheduled delivery (owner, 2026-10-10; the Flutter shop's delivery_slot_model.dart,
 * checkout_slot_picker.dart and cart_screen_payment_container.dart). GET /orders/slots says
 * whether slots are on, whether "As soon as possible" is allowed now, and the windows with
 * room left. While the store is closed ASAP is not offered, but a slot can still be booked;
 * the server re-checks the slot (offered, not full) when the order is placed.
 */

export interface DeliverySlot {
  /** The ISO start exactly as sent: POST /orders takes this very string back as delivery_slot_start. */
  start: string;
  end: string;
  day_label: string;
  time_label: string;
  /** "Today 4-6 PM". */
  label: string;
  remaining: number;
  /** False when the slot is full. */
  available: boolean;
}

export interface DeliverySlots {
  enabled: boolean;
  asap_available: boolean;
  is_open_now?: boolean;
  closed_kind?: string | null;
  closed_reason?: string | null;
  reopens_at?: string | null;
  next_open_at?: string | null;
  slots: DeliverySlot[];
}

export const SLOT_COPY = {
  title: 'Delivery time',
  asap: 'As soon as possible',
  full: 'Full',
  closedNote: "We're closed now. Pick a time and we'll deliver then.",
  noSlots: 'No delivery times left right now. Check back later.',
  loadFailed: "We couldn't load delivery times.",
  pickSlotHint: 'Pick a delivery time above to order now.',
  slotPickedHint: "We'll deliver at the time you picked.",
} as const;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

function parseSlot(raw: unknown): DeliverySlot | null {
  if (!isObj(raw)) return null;
  const { start, end, day_label: day, time_label: time, label } = raw;
  if (typeof start !== 'string' || !Number.isFinite(Date.parse(start))) return null;
  if (typeof end !== 'string' || typeof day !== 'string' || typeof time !== 'string') return null;
  const rem = typeof raw.remaining === 'number' && Number.isFinite(raw.remaining) ? Math.max(0, Math.floor(raw.remaining)) : 0;
  return {
    start, end, day_label: day, time_label: time,
    label: typeof label === 'string' && label ? label : `${day} ${time}`,
    remaining: rem,
    available: raw.available === true && rem > 0,
  };
}

/** GET /orders/slots data, defensively (a bad row is dropped, never shown). null when unusable. */
export function parseSlots(raw: unknown): DeliverySlots | null {
  if (!isObj(raw) || typeof raw.enabled !== 'boolean') return null;
  const list = Array.isArray(raw.slots) ? raw.slots : [];
  return {
    enabled: raw.enabled,
    asap_available: typeof raw.asap_available === 'boolean' ? raw.asap_available : raw.is_open_now === true,
    is_open_now: typeof raw.is_open_now === 'boolean' ? raw.is_open_now : undefined,
    closed_kind: typeof raw.closed_kind === 'string' ? raw.closed_kind : null,
    closed_reason: typeof raw.closed_reason === 'string' ? raw.closed_reason : null,
    reopens_at: typeof raw.reopens_at === 'string' ? raw.reopens_at : null,
    next_open_at: typeof raw.next_open_at === 'string' ? raw.next_open_at : null,
    slots: raw.enabled ? list.map(parseSlot).filter((s): s is DeliverySlot => s !== null) : [],
  };
}

/** The slots grouped by day label, in the server's order. */
export function slotsByDay(slots: DeliverySlot[]): { day: string; slots: DeliverySlot[] }[] {
  const out: { day: string; slots: DeliverySlot[] }[] = [];
  for (const s of slots) {
    const g = out.find((x) => x.day === s.day_label);
    if (g) g.slots.push(s);
    else out.push({ day: s.day_label, slots: [s] });
  }
  return out;
}

/** The slot starting at `start` while it is still offered with room; null otherwise. */
export function availableSlot(s: DeliverySlots | null, start: string | null): DeliverySlot | null {
  if (!s || !s.enabled || !start) return null;
  const hit = s.slots.find((x) => x.start === start);
  return hit && hit.available ? hit : null;
}

/** "As soon as possible" is offered: the store is open (and the slots answer agrees). */
export const asapOffered = (s: DeliverySlots | null, storeOpen: boolean) => storeOpen && (s ? s.asap_available : true);

/**
 * Whether Place order may go: open for ASAP, or (closed or not) a picked slot that still has
 * room. A closed store with slots off can't take the order.
 */
export function canOrderNow(args: { storeOpen: boolean; slots: DeliverySlots | null; picked: string | null }): boolean {
  const slot = availableSlot(args.slots, args.picked);
  if (slot) return true;
  return asapOffered(args.slots, args.storeOpen);
}

/** The slot start that goes with the order (undefined = as soon as possible). */
export const slotForOrder = (s: DeliverySlots | null, picked: string | null): string | undefined =>
  availableSlot(s, picked)?.start;
