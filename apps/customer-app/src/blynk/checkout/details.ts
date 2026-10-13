import { toE164 } from '@/blynk/auth/phone';
import type { PlaceOrderBody } from '@/blynk/orders/types';

/*
 * "Delivery details" at checkout (owner, 2026-10-12; the Flutter shop's
 * checkout_recipient_section.dart and OrderProvider): "For someone else" with the
 * receiver's name and Sri Lankan mobile for THIS order only, "Needs help at the door",
 * and a note for the rider. "For someone else" shows only while staff allow it
 * (checkout-info `order_for_someone_else.enabled`); the note and "needs help" always show.
 */

/** Flutter's limits (tighter than the server's 128 / 500). */
export const RECIPIENT_NAME_MIN = 2;
export const RECIPIENT_NAME_MAX = 80;
export const NOTE_MAX = 300;

export const DETAILS_COPY = {
  title: 'Delivery details',
  forSomeoneElse: 'For someone else',
  forSomeoneElseSub: (codeToReceiver: boolean) => (codeToReceiver
    ? 'Send this order to family. They get the order texts and the delivery code; you get updates too.'
    : 'Send this order to family. They get the order texts; you get the delivery code and updates.'),
  nameLabel: "Receiver's name",
  phoneLabel: "Receiver's mobile",
  phoneHint: '07X XXX XXXX',
  onlyThisOrder: 'Only for this order - your saved address stays the same.',
  needsHelp: 'Needs help at the door',
  needsHelpHint: 'Elderly or unwell: the rider knocks, waits and carries the items inside.',
  noteLabel: 'Note for the rider (optional)',
  noteHint: 'Gate, floor, landmark',
  nameError: "Enter the receiver's name",
  phoneError: "Enter the receiver's Sri Lankan mobile number",
  noteError: 'Check the note for the rider',
} as const;

export interface CheckoutDetails {
  forSomeoneElse: boolean;
  recipientName: string;
  recipientPhone: string;
  /** Quick picks ("Leave at door", ...) that start the note. */
  noteChips: string[];
  note: string;
  needsHelp: boolean;
}

export const EMPTY_DETAILS: CheckoutDetails = {
  forSomeoneElse: false, recipientName: '', recipientPhone: '', noteChips: [], note: '', needsHelp: false,
};

/** Trims the ends and collapses runs of whitespace. */
export const normalizeText = (v: string | null | undefined) => (v ?? '').trim().replace(/\s+/g, ' ');

const NAME_CHARS = /^[\p{L} '\-.]+$/u;

export function recipientNameError(v: string): string | null {
  const t = normalizeText(v);
  return t.length < RECIPIENT_NAME_MIN || t.length > RECIPIENT_NAME_MAX || !NAME_CHARS.test(t) ? DETAILS_COPY.nameError : null;
}

export const recipientPhoneError = (v: string): string | null => (toE164(v) ? null : DETAILS_COPY.phoneError);

/** The note that goes to the rider: the quick picks, then the typed note. */
export function deliveryNote(d: Pick<CheckoutDetails, 'noteChips' | 'note'>): string {
  const typed = normalizeText(d.note);
  return [...d.noteChips, ...(typed ? [typed] : [])].join(', ');
}

export const noteError = (d: Pick<CheckoutDetails, 'noteChips' | 'note'>): string | null =>
  normalizeText(d.note).length > NOTE_MAX || deliveryNote(d).length > 500 ? DETAILS_COPY.noteError : null;

/**
 * What stops the order going, or null. `allowForSomeoneElse` false (staff switched it off)
 * ignores the receiver, as the Flutter shop does.
 */
export function detailsProblem(d: CheckoutDetails, allowForSomeoneElse: boolean): string | null {
  if (allowForSomeoneElse && d.forSomeoneElse) {
    if (recipientNameError(d.recipientName)) return DETAILS_COPY.nameError;
    if (recipientPhoneError(d.recipientPhone)) return DETAILS_COPY.phoneError;
  }
  return noteError(d);
}

/** The POST /orders fields for the receiver, the note and "needs help". */
export function detailsBody(d: CheckoutDetails, allowForSomeoneElse: boolean):
  Pick<PlaceOrderBody, 'for_someone_else' | 'recipient' | 'delivery_note' | 'needs_help'> {
  const note = deliveryNote(d);
  return {
    ...(allowForSomeoneElse && d.forSomeoneElse
      ? { for_someone_else: true, recipient: { name: normalizeText(d.recipientName), phone: toE164(d.recipientPhone) ?? d.recipientPhone.trim() } }
      : {}),
    ...(note ? { delivery_note: note } : {}),
    ...(d.needsHelp ? { needs_help: true } : {}),
  };
}
