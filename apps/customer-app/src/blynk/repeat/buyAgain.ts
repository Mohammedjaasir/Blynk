import type { Product } from '@/blynk/api/types';
import type { BuyAgainEntry } from './models';

/*
 * Home's "Buy again" rail: GET /me/buy-again (the customer's delivered products, ranked by how
 * often and how recently) joined with the live catalogue for today's name, photo, price and
 * stock. Orderable products keep the server's order; sold-out / switched-off ones go to the end
 * (greyed by the card). A product bought in several sizes is one card (the "+" opens its size
 * picker). Products no longer in the catalogue are left out. Pure.
 */

export interface BuyAgainCard {
  product: Product;
  timesBought: number;
  lastQuantity: number;
  /** The size bought last time (null without sizes). */
  variantId: string | null;
}

export const BUY_AGAIN_MAX = 16;

export function joinBuyAgain(entries: BuyAgainEntry[], products: Product[], max = BUY_AGAIN_MAX): BuyAgainCard[] {
  const byId = new Map(products.map((p) => [p.id, p] as const));
  const seen = new Set<string>();
  const orderable: BuyAgainCard[] = [];
  const later: BuyAgainCard[] = [];
  for (const e of entries) {
    if (seen.has(e.productId)) continue;
    const product = byId.get(e.productId);
    if (!product) continue;
    seen.add(e.productId);
    const card = { product, timesBought: e.timesBought, lastQuantity: e.lastQuantity, variantId: e.variantId };
    (product.is_available ? orderable : later).push(card);
  }
  return [...orderable, ...later].slice(0, max);
}

/**
 * What the rail shows: nothing while unknown (no flash of the empty card), the cards, or the
 * animated empty card (a guest, or a customer without a delivered order yet). A failed call on a
 * signed-in customer hides the rail (an older API has no endpoint: never claim "no history").
 */
export type BuyAgainView = { kind: 'hidden' } | { kind: 'empty' } | { kind: 'cards'; cards: BuyAgainCard[] };

export function buyAgainView(args: {
  demo: boolean;
  signedIn: boolean;
  /** null while loading; 'failed' when the call failed. */
  entries: BuyAgainEntry[] | null | 'failed';
  products: Product[] | null;
}): BuyAgainView {
  if (args.demo) return { kind: 'hidden' };
  if (!args.signedIn) return { kind: 'empty' };
  if (args.entries === 'failed') return { kind: 'hidden' };
  if (args.entries === null || args.products === null) return { kind: 'hidden' };
  const cards = joinBuyAgain(args.entries, args.products);
  return cards.length ? { kind: 'cards', cards } : { kind: 'empty' };
}

/** The small line under a card: "Bought 5 times" / "Bought once". */
export const boughtText = (n: number) => (n <= 1 ? 'Bought once' : n === 2 ? 'Bought twice' : `Bought ${n} times`);
