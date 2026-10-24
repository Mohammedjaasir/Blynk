import { localized } from '@/blynk/i18n/localized';
import type { FreeDeliveryStatus } from '../orders/types';

/*
 * What Home (and the cart bar) may say about free deliveries. Always nothing now (owner,
 * 2026-10-16: "we are not giving free delivery remove that or replace with any other
 * wordings" - said again on the Home band, the fee strip and the cart bar strip after the
 * hero banner, the promo band and the cart bill were already fixed). The free-delivery
 * feature and its Admin / Ops switches are untouched; this only stops the claim being made,
 * everywhere it is asked.
 *
 * Earlier rule, kept here for when the owner wants it back: a guest heard GET /store's
 * new-customer offer ("for new customers"); signed in, only what GET /orders/checkout-info
 * said for that customer (`free_delivery.remaining`, counted across the same verified phone
 * number), nothing claimed until that was known.
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
  return NO_CLAIM;
}

const CLAIM_WORDS = localized(
  {
    lineNew: (n: number) => (n === 1 ? 'First delivery free for new customers' : `First ${n} deliveries free for new customers`),
    linePersonal: (n: number) => (n === 1 ? '1 free delivery left' : `Your next ${n} deliveries free`),
    titleNew: (n: number) => (n === 1 ? 'FIRST DELIVERY FREE' : `FIRST ${n} DELIVERIES FREE`),
    titlePersonal: (n: number) => (n === 1 ? '1 FREE DELIVERY LEFT' : `NEXT ${n} DELIVERIES FREE`),
    feeNew: (n: number): [string, string] => [String(n), 'Free · new users'],
    feePersonal: (n: number): [string, string] => [String(n), n === 1 ? 'Free delivery left' : 'Free left'],
    promoNew: (n: number) => `Free delivery on your first ${n === 1 ? 'order' : `${n} orders`} for new customers`,
    promoPersonal: (n: number) => (n === 1 ? 'Your next delivery is free' : `Your next ${n} ${n === 1 ? 'delivery' : 'deliveries'} are free`),
  },
  {
    si: {
      lineNew: (n: number) => (n === 1 ? 'අලුත් පාරිභෝගිකයන්ට පළමු බෙදාහැරීම නොමිලේ' : `අලුත් පාරිභෝගිකයන්ට පළමු බෙදාහැරීම් ${n} නොමිලේ`),
      linePersonal: (n: number) => (n === 1 ? 'නොමිලේ බෙදාහැරීමක් 1ක් ඉතිරියි' : `ඔබේ ඊළඟ බෙදාහැරීම් ${n} නොමිලේ`),
      titleNew: (n: number) => (n === 1 ? 'පළමු බෙදාහැරීම නොමිලේ' : `පළමු බෙදාහැරීම් ${n} නොමිලේ`),
      titlePersonal: (n: number) => (n === 1 ? 'නොමිලේ බෙදාහැරීමක් 1ක් ඉතිරියි' : `ඊළඟ බෙදාහැරීම් ${n} නොමිලේ`),
      feeNew: (n: number): [string, string] => [String(n), 'නොමිලේ · අලුත් අයට'],
      feePersonal: (n: number): [string, string] => [String(n), n === 1 ? 'නොමිලේ බෙදාහැරීම ඉතිරියි' : 'නොමිලේ ඉතිරියි'],
      promoNew: (n: number) => (n === 1 ? 'අලුත් පාරිභෝගිකයන්ට ඔබේ පළමු ඇණවුමට බෙදාහැරීම නොමිලේ' : `අලුත් පාරිභෝගිකයන්ට ඔබේ පළමු ඇණවුම් ${n}ට බෙදාහැරීම නොමිලේ`),
      promoPersonal: (n: number) => (n === 1 ? 'ඔබේ ඊළඟ බෙදාහැරීම නොමිලේ' : `ඔබේ ඊළඟ බෙදාහැරීම් ${n} නොමිලේ`),
    },
    ta: {
      lineNew: (n: number) => (n === 1 ? 'புதிய வாடிக்கையாளர்களுக்கு முதல் டெலிவரி இலவசம்' : `புதிய வாடிக்கையாளர்களுக்கு முதல் ${n} டெலிவரி இலவசம்`),
      linePersonal: (n: number) => (n === 1 ? 'இலவச டெலிவரி 1 மீதம் உள்ளது' : `உங்கள் அடுத்த ${n} டெலிவரி இலவசம்`),
      titleNew: (n: number) => (n === 1 ? 'முதல் டெலிவரி இலவசம்' : `முதல் ${n} டெலிவரி இலவசம்`),
      titlePersonal: (n: number) => (n === 1 ? '1 இலவச டெலிவரி மீதம்' : `அடுத்த ${n} டெலிவரி இலவசம்`),
      feeNew: (n: number): [string, string] => [String(n), 'இலவசம் · புதியவர்களுக்கு'],
      feePersonal: (n: number): [string, string] => [String(n), n === 1 ? 'இலவச டெலிவரி மீதம்' : 'இலவசம் மீதம்'],
      promoNew: (n: number) => (n === 1 ? 'புதிய வாடிக்கையாளர்களுக்கு முதல் ஆர்டருக்கு டெலிவரி இலவசம்' : `புதிய வாடிக்கையாளர்களுக்கு முதல் ${n} ஆர்டர்களுக்கு டெலிவரி இலவசம்`),
      promoPersonal: (n: number) => (n === 1 ? 'உங்கள் அடுத்த டெலிவரி இலவசம்' : `உங்கள் அடுத்த ${n} டெலிவரி இலவசம்`),
    },
  },
  'store.CLAIMS',
);

/** Aisle card / meta line: "First 2 deliveries free for new customers", "Your next 2 deliveries free", "1 free delivery left". */
export function claimLine(c: FreeClaim): string | null {
  if (c.kind === 'new-customer') return CLAIM_WORDS.lineNew(c.count);
  if (c.kind === 'personal') return CLAIM_WORDS.linePersonal(c.count);
  return null;
}

/** The "NO PACKAGING FEE & NO PLATFORM FEE" band's big title, or null (the caller picks a true one). */
export function claimTitle(c: FreeClaim): string | null {
  if (c.kind === 'new-customer') return CLAIM_WORDS.titleNew(c.count);
  if (c.kind === 'personal') return CLAIM_WORDS.titlePersonal(c.count);
  return null;
}

/** The bottom fee strip's third item ([coin, label]), or null (the caller shows the fee instead). */
export function claimFee(c: FreeClaim): [string, string] | null {
  if (c.kind === 'new-customer') return CLAIM_WORDS.feeNew(c.count);
  if (c.kind === 'personal') return CLAIM_WORDS.feePersonal(c.count);
  return null;
}

/** The cart bar's free-delivery strip line, or null. */
export function claimPromoLine(c: FreeClaim): string | null {
  if (c.kind === 'new-customer') return CLAIM_WORDS.promoNew(c.count);
  if (c.kind === 'personal') return CLAIM_WORDS.promoPersonal(c.count);
  return null;
}
