/*
 * Live (DEMO=false) content for the cart, login, OTP and address screens. Everything here is
 * either true Blynk copy or derived from GET /store, which Admin/Ops control. No taxes,
 * distances, ratings or invented savings: a slot with nothing true to say is hidden.
 */
import type { StoreInfo } from '@/blynk/api/types';
import { formatLkr } from '@/blynk/lib/money';
import { deliveryFeeText, flatFee, freeDeliveryCount } from '@/blynk/lib/storeText';

const round2 = (n: number) => Math.round(n * 100) / 100;

export type LiveBill = {
  /** New-customer free deliveries switched on in Admin (0 when off or the cart is empty). */
  freeCount: number;
  /** "LKR 100", "Calculated at checkout" or "FREE · first 2 deliveries". */
  feeText: string;
  /** The fee is a known flat amount and is already inside `toPay`. */
  feeKnown: boolean;
  toPay: number;
  /** Struck "before" amount (regular prices + the same fee); only meaningful when `showSaved`. */
  toPayRegular: number;
  saved: number;
  /** Offer savings are shown only when Admin's show_offer_savings is on and an offer is active. */
  showSaved: boolean;
};

/** The bill for the cart's available lines (`total` at effective prices, `mrpTotal` at regular prices). */
export function liveBill(store: StoreInfo | null, total: number, mrpTotal: number, count: number): LiveBill {
  const freeCount = count > 0 ? freeDeliveryCount(store) : 0;
  const flat = flatFee(store);
  const feeKnown = freeCount === 0 && flat != null;
  const added = feeKnown ? (flat as number) : 0;
  const saved = Math.max(0, round2(mrpTotal - total));
  return {
    freeCount,
    feeText: deliveryFeeText(store, formatLkr),
    feeKnown,
    toPay: round2(total + added),
    toPayRegular: round2(mrpTotal + added),
    saved,
    showSaved: store?.show_offer_savings === true && saved > 0,
  };
}

/** Rows of the offers card: only what is true right now. An empty list hides the card. */
export function liveOfferRows(bill: LiveBill): { key: string; label: string; right: string; kind: 'tag' | 'bag' }[] {
  const rows: { key: string; label: string; right: string; kind: 'tag' | 'bag' }[] = [];
  if (bill.showSaved) rows.push({ key: 'saved', label: `${formatLkr(bill.saved)} saved with offer prices`, right: '✓ Applied', kind: 'tag' });
  if (bill.freeCount > 0) {
    rows.push({ key: 'free', label: `Free delivery on your first ${bill.freeCount} order${bill.freeCount > 1 ? 's' : ''}`, right: '✓ At checkout', kind: 'bag' });
  }
  return rows;
}

export const LIVE = {
  storeTitle: (store: StoreInfo | null) => (store?.hub_name ? `Blynk · ${store.hub_name}` : 'Blynk'),
  /** Fee header: Blynk adds no packaging or platform fee, so this is the one true claim it makes. */
  feePill: 'No packaging fee · No platform fee',
  burst1: ['NO PACKAGING FEE', 'NO PLATFORM FEE'] as const,
  burst2: { big: 'LKR 0', lines: ['Packaging fee', 'Platform fee'] as const },
  hurraySub: (n: number) => `On your first ${n} order${n > 1 ? 's' : ''} with Blynk`,
  mealTitle: 'COMPLETE YOUR BASKET',
  freeNote: (n: number) => `Applied at checkout to your first ${n} order${n > 1 ? 's' : ''}.`,
  thatsIt: 'No packaging or platform fee.',
  policy: 'You can cancel your order until it is out for delivery.',
  unavailable: 'Unavailable',
  remove: 'Remove',
  refreshFailed: "Couldn't refresh prices. Check your connection.",
  closedCta: 'Store closed right now',
  notice: 'Ordering from the new app opens soon',
  // login: Sri Lankan mobile numbers, 9 digits after +94 (a leading 0 is dropped)
  countryFlag: '🇱🇰',
  countryCode: '+94',
  phoneDigits: 9,
  phoneOk: (n: string) => /^7\d{8}$/.test(n),
  // OTP: nothing is sent or checked in this phase
  otpSentTo: (phone: string) => `Preview only: no code is sent to +94 ${phone}`,
  otpNote: 'Phone sign-in opens with ordering. Any 6 digits continue the preview.',
  otpCta: 'Continue preview',
  // address: a drawing, not a real map; no place names are invented
  address: {
    search: 'Address search opens with ordering',
    current: 'Recenter',
    loadingHint: 'Map preview · not a real map of your area',
    placedHint: 'Map preview · not a real map of your area',
    name: 'Pin preview',
    line: 'Exact address search arrives with ordering. Nothing is sent from this screen.',
    cta: 'Confirm preview & proceed',
    saved: { title: 'Home (preview)', line: 'Pin preview, not verified' },
  },
};
