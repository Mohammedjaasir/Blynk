/*
 * The checkout bill's header: "To Pay ~~before~~ now" and "LKR X saved on the total!".
 * Everything the customer saves counts: offer prices (always shown, as everywhere else since
 * owner, 2026-10-18), plus the one discount (coupon, birthday gift or referral reward) and
 * Blynk Points. "To Pay" itself is computed elsewhere and is already right; this only words it.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number | null | undefined) => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0);

export interface SavingsInput {
  /** Regular prices minus offer prices for the cart's lines. */
  offerSaved: number;
  /** Offer savings may be shown (owner, 2026-10-18: always true). */
  showOfferSavings: boolean;
  /** The coupon / birthday / referral discount on this bill (0 when none). */
  discount: number;
  /** The value of the Blynk Points used (0 when none). */
  pointsValue: number;
  /** The amount to pay (already net of every saving, and of the wallet). */
  toPay: number;
  /**
   * What the Blynk Wallet pays. A payment, not a saving: it is never counted as saved, but the
   * struck "before" amount adds it back so it is the order's full price.
   */
  walletUsed?: number;
}

export interface SavingsHeader {
  /** Total saved; 0 hides the line. */
  saved: number;
  /** The struck "before" amount: what it would cost without any saving. */
  before: number;
  show: boolean;
}

export function savingsHeader(i: SavingsInput): SavingsHeader {
  const offer = i.showOfferSavings ? money(i.offerSaved) : 0;
  const saved = round2(offer + money(i.discount) + money(i.pointsValue));
  return { saved, before: round2(i.toPay + money(i.walletUsed) + saved), show: saved > 0 };
}
