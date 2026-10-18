/*
 * Live (DEMO=false) content for the cart, login, OTP, registration, birthday and address screens. Everything here is
 * either true Blynk copy or derived from GET /store, which Admin/Ops control. No taxes,
 * distances, ratings or invented savings: a slot with nothing true to say is hidden.
 */
import type { StoreInfo } from '@/blynk/api/types';
import { formatLkr } from '@/blynk/lib/money';
import { deliveryFeeText, flatFee, freeDeliveryCount, offerSavingsOn } from '@/blynk/lib/storeText';

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
  /** Offer savings are shown whenever an offer is active (owner, 2026-10-18: always on). */
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
    showSaved: offerSavingsOn(store) && saved > 0,
  };
}

/**
 * Rows of the offers card: only what is true right now. An empty list hides the card. No
 * free-delivery row (owner, 2026-10-16: "we are not giving free delivery, remove that or
 * replace with any other wordings").
 */
export function liveOfferRows(bill: LiveBill): { key: string; label: string; right: string; kind: 'tag' | 'bag' }[] {
  const rows: { key: string; label: string; right: string; kind: 'tag' | 'bag' }[] = [];
  if (bill.showSaved) rows.push({ key: 'saved', label: `${formatLkr(bill.saved)} saved with offer prices`, right: '✓ Applied', kind: 'tag' });
  return rows;
}

/**
 * The cart pop-up's sub-line: no fees, no delivery, just a catchy greeting (owner, 2026-10-17:
 * "no fees related topic we need different different wording each time they adding"). One is
 * picked at random each time the pop-up shows.
 */
export const HURRAY_LINES = [
  'Great picks today!',
  'Your basket is looking great!',
  'Thanks for shopping with Blynk!',
  'Quality you can count on.',
  'Happy shopping!',
  "You've got good taste.",
] as const;

export const randomHurrayLine = (): string => HURRAY_LINES[Math.floor(Math.random() * HURRAY_LINES.length)];

export const LIVE = {
  storeTitle: (store: StoreInfo | null) => (store?.hub_name ? `Blynk · ${store.hub_name}` : 'Blynk'),
  /**
   * Fee header: catchy, nothing about fees or delivery at all (owner, 2026-10-18: "in top we
   * dont need content or wording related to fee delivery something replace with any other" -
   * said again after "Honest pricing" / "Zero hidden costs" turned out to still read as a fee
   * topic).
   */
  feePill: 'Fresh groceries, every day',
  burst1: ['FRESH GROCERIES', 'EVERY DAY'] as const,
  burst2: { big: 'FRESH', lines: ['Groceries', 'Every day'] as const },
  /**
   * The cart's pop-up: not shown live any more (owner, 2026-10-18: "remove that pop up", the
   * third round after "bring it back" then "reword it"). Kept here, unused, in case it comes
   * back a fourth time - HURRAY_LINES above picks a fresh sub-line when it does.
   */
  hurrayTitle: 'You\'re all set!',
  hurrayCta: 'Got it!',
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
  sending: 'Sending code…',
  // OTP: POST /auth/otp/request sends a 6-digit code by SMS; it is checked by /auth/otp/verify
  otpSentTo: (phone: string) => `OTP sent to ${phone}`,
  resendIn: (s: number) => `Resend OTP in ${s} s`,
  resend: 'Resend OTP',
  resending: 'Sending a new code…',
  resent: 'A new code is on its way.',
  verifying: 'Verifying…',
  devCode: (code: string) => `Dev code: ${code}`,
  devFill: 'Tap to fill',
  // first sign-in: registration (the account has no name yet), then an optional birthday
  register: {
    title: 'Welcome to Blynk',
    signedInAs: (phone: string) => `Signed in with ${phone}`,
    heading: "What's your name?",
    sub: 'So your rider knows who to hand your order to.',
    nameLabel: 'Your name',
    nameHint: 'e.g. Nimal Perera',
    referralLabel: 'Referral code (optional)',
    referralHelp: "Got a friend's code? Enter it for a reward on your first order.",
    referralBad: 'Referral codes are 3 to 32 letters and numbers.',
    cta: 'Continue',
    saving: 'Saving…',
  },
  birthday: {
    title: 'Tell us your birthday for a gift',
    body: "Get a little something off one order in your birthday week. It's optional, and you can change it any time in Profile.",
    day: 'DD',
    month: 'MM',
    year: 'YYYY',
    bad: 'Enter a real date of birth.',
    save: 'Save birthday',
    saving: 'Saving…',
    skip: 'Skip',
  },
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
