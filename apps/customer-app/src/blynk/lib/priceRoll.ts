import type { Product } from '@/blynk/api/types';
import type { PointsRule } from '@/blynk/store/pointsPromo';
import { PRICE_ROLL } from '@/blynk/ui/strings';
import type { PriceDisplay, StruckPrice } from './pricing';

/*
 * The rolling line under a product tile's price (owner, 2026-10-15: "like in Toing app"). Toing
 * rolls "Other apps: ₹120–125" <-> "Our app: 30% lower" under every price; Blynk cannot claim
 * other apps' prices, so the line rolls between two TRUE facts the tile already knows:
 *
 *   line A  the struck reference priceDisplay already decides (the regular price on an offer, or
 *           "MRP LKR 300"), shown whenever there is one (owner, 2026-10-18: always on).
 *   line B  the saving against that reference, ONE wording:
 *             - a category offer (offer_kind CATEGORY, regular price struck): "5% off", the same
 *               words as the aisle's "5% off everything here";
 *             - anything else: "Save LKR 27", plus " vs MRP" when the reference is the MRP and the
 *               tile has room for it.
 *
 * The line is STATIC (line A only, no roll) when the saving is not clean: a sized product shown as
 * a full "LKR 50 – 350" range or "From LKR 50", a sized tile whose shown price is not the
 * product's own price, a sold-out tile (nothing to save on today), or a saving under LKR 1 / 1%.
 *
 * Products without a saving get no line. Blynk Points do NOT add "Earn N pts" here (decided
 * 2026-10-15): points are earned on the whole order (items after discounts, in full LKR 100 steps,
 * once delivered), so a per-tile number is not exact for a basket; most tiles would gain a second
 * label beside "Delivered from ..." (the clean-minimal one-label rule); and Home already states the
 * earn rule once (hero banner, yellow band, fee strip). `points` is taken so the rule is explicit
 * and tested. Pure: no React.
 */

export type PriceRoll = {
  /** Line A: the struck reference (always shown; the only line under reduced motion). */
  struck: StruckPrice;
  /** Line B: the saving, or null = no roll (line A stays still). */
  saving: { text: string; kind: 'pct' | 'lkr' } | null;
  /** Both facts as one screen-reader label ("MRP LKR 300, Save LKR 20 vs MRP"). */
  label: string;
};

export type PriceRollInput = {
  /** priceDisplay(p, { showStruck }) for the tile. */
  shown: PriceDisplay;
  /** The tile's struck reference after sizedStruck (null: nothing struck, no line). */
  struck: StruckPrice | null;
  /** The amount the tile's price line shows, and whether it shows exactly one price (no range, no "From"). */
  priceShown: { amount: number; single: boolean };
  offerKind: Product['offer_kind'] | undefined;
  /** The product can be ordered now (a sold-out tile keeps line A still). */
  available: boolean;
  /** GET /store points_program (pointsRuleOf). Never adds a line; see above. */
  points: PointsRule | null;
  /** How many characters line B may take (from the tile width); " vs MRP" is dropped past it. */
  maxChars?: number;
  money: (n: number) => string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function priceRoll(i: PriceRollInput): PriceRoll | null {
  const { struck, shown, money } = i;
  if (!struck || !(struck.amount > 0)) return null;
  const a11yA = struck.kind === 'mrp' ? PRICE_ROLL.mrp(money(struck.amount)) : PRICE_ROLL.regular(money(struck.amount));
  const still: PriceRoll = { struck, saving: null, label: a11yA };
  // a clean saving: the tile shows one price, and it is the price the reference is struck against
  if (!i.available || !i.priceShown.single || Math.abs(i.priceShown.amount - shown.price) > 0.005) return still;
  const save = round2(struck.amount - shown.price);
  if (!(save >= 1)) return still;
  let saving: PriceRoll['saving'];
  const pct = Math.floor((save / struck.amount) * 100 + 0.05); // never rounds a saving up by more than 0.05 pt
  if (shown.offer && i.offerKind === 'CATEGORY' && struck.kind === 'regular' && pct >= 1) {
    saving = { text: PRICE_ROLL.pctOff(pct), kind: 'pct' };
  } else {
    const base = PRICE_ROLL.save(money(save));
    const full = struck.kind === 'mrp' ? base + PRICE_ROLL.vsMrp : base;
    saving = { text: i.maxChars != null && full.length > i.maxChars ? base : full, kind: 'lkr' };
  }
  return { struck, saving, label: `${a11yA}, ${saving.text}` };
}

/** A tile's phase in the shared roll loop (0..1): staggered by its place in a row and its id. */
export function rollPhase(index: number, id: string): number {
  let h = 0;
  for (let k = 0; k < id.length; k++) h = (h * 31 + id.charCodeAt(k)) >>> 0;
  return (index * 0.23 + (h % 1000) / 1000 * 0.5) % 1;
}
