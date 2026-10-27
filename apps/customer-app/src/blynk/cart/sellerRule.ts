import type { Combo, Product } from '../api/types';
import type { CartVariant } from './cartStore';
import { SELLER_RULE_WORDS } from './sellerWords';

/*
 * One seller per order (owner's brother, 2026-10-27, "Option A"). A cart may hold items from only one
 * source: one approved seller's shop, or Blynk's own stock. GET /store sends `one_seller_per_order`
 * (the admin switch); an older server sends nothing and then there is no rule. The server enforces
 * it again at POST /orders (422 MIXED_SELLERS_NOT_ALLOWED). Pure helpers here; the cart wires them
 * (src/lib/cart.tsx) and sellerGuard.ts runs the question.
 */

export interface CartSource {
  /** Same key = same source: `blynk`, `seller:<id>`, or `seller:name:<shop>` when the id is missing. */
  key: string;
  /** The shop name, "Blynk", or '' when the server sent a seller id without a name (use `sourceName`). */
  name: string;
}

export const BLYNK_SOURCE: CartSource = { key: 'blynk', name: 'Blynk' };

/** Where a product comes from: its seller (seller_id, else the shop name), or Blynk. */
export function sourceOf(p: Pick<Product, 'seller_id' | 'sold_by'>): CartSource {
  const id = typeof p.seller_id === 'string' ? p.seller_id.trim() : '';
  const shop = typeof p.sold_by === 'string' ? p.sold_by.trim() : '';
  if (id) return { key: `seller:${id}`, name: shop };
  if (shop) return { key: `seller:name:${shop.toLowerCase()}`, name: shop };
  return BLYNK_SOURCE;
}

/** The name to show for a source (a nameless seller reads "another seller"). Read while rendering. */
export const sourceName = (s: CartSource) => s.name || SELLER_RULE_WORDS.unnamedSeller;

/** The rule is on only when GET /store says so: absent (an older server) means off. */
export const ruleFromStore = (store: { one_seller_per_order?: boolean } | null | undefined) => store?.one_seller_per_order === true;

let ruleOn = false;
/** The store provider keeps this in step with GET /store; the cart reads it outside React. */
export function setOneSellerRule(on: boolean) { ruleOn = on; }
export const oneSellerRuleOn = () => ruleOn;

/** What goes into the cart: units of a product (or of one size of it), or packs of a combo. */
export type AddEntry =
  | { kind: 'product'; product: Product; variant?: CartVariant | null; quantity: number }
  | { kind: 'combo'; combo: Combo; quantity: number };

/** A combo pack is Blynk's own (its items carry no seller; the server still checks them at checkout). */
export const entrySource = (e: AddEntry): CartSource => (e.kind === 'combo' ? BLYNK_SOURCE : sourceOf(e.product));

const distinct = (sources: CartSource[]): CartSource[] => {
  const seen = new Set<string>();
  return sources.filter((s) => !seen.has(s.key) && !!seen.add(s.key));
};

/** The distinct sources in a cart, in the order they appear (product lines first, then combo packs). */
export function cartSources(lines: readonly { product: Product }[], combos: readonly unknown[] = []): CartSource[] {
  return distinct([...lines.map((l) => sourceOf(l.product)), ...(combos.length ? [BLYNK_SOURCE] : [])]);
}

/** The cart's source (the first one), or null for an empty cart. */
export const cartSource = (lines: readonly { product: Product }[], combos: readonly unknown[] = []): CartSource | null =>
  cartSources(lines, combos)[0] ?? null;

export interface SourceConflict { cartSource: CartSource; productSource: CartSource }

/**
 * Adding `product` to the cart would bring in a NEW source while the rule is on and the cart is not
 * empty. Another item from a source the cart already has is never a conflict (so a cart that was
 * mixed before the rule can still grow from the sources it has).
 */
export function conflictFor(
  lines: readonly { product: Product }[],
  product: Pick<Product, 'seller_id' | 'sold_by'>,
  rule: boolean,
  combos: readonly unknown[] = [],
): SourceConflict | null {
  if (!rule) return null;
  const have = cartSources(lines, combos);
  if (have.length === 0) return null;
  const productSource = sourceOf(product);
  return have.some((s) => s.key === productSource.key) ? null : { cartSource: have[0], productSource };
}

/** Units (a combo pack counts as one). */
export const entryUnits = (entries: readonly AddEntry[]) => entries.reduce((a, e) => a + e.quantity, 0);

export type AddPlan =
  /** Put `entries` in; `leftOut` units from other sellers were dropped (empty cart, mixed list). */
  | { kind: 'add'; entries: AddEntry[]; leftOut: number }
  /** Ask first. `entries` is what "Clear cart and add" adds (one source), `leftOut` the units it leaves out. */
  | { kind: 'ask'; cartSource: CartSource; entries: AddEntry[]; leftOut: number };

/**
 * What to do with an add (one item, or a bulk list: Add all, reorder). With the rule off, or nothing
 * new, everything goes in. An empty cart takes the list's first source and leaves the rest out. A cart
 * that would get a new source asks once: the new cart is the first source of the list that the cart
 * does not already have, the rest is left out.
 */
export function planAdd(
  lines: readonly { product: Product }[],
  combos: readonly unknown[],
  entries: readonly AddEntry[],
  rule: boolean,
): AddPlan {
  const all = [...entries];
  if (!rule || all.length === 0) return { kind: 'add', entries: all, leftOut: 0 };
  const have = cartSources(lines, combos);
  const listed = distinct(all.map(entrySource));
  const foreign = have.length === 0 ? listed : listed.filter((s) => !have.some((h) => h.key === s.key));
  if (have.length > 0 && foreign.length === 0) return { kind: 'add', entries: all, leftOut: 0 };
  // empty cart: only a mixed list needs trimming
  if (have.length === 0 && listed.length <= 1) return { kind: 'add', entries: all, leftOut: 0 };
  const first = foreign[0];
  const keep = all.filter((e) => entrySource(e).key === first.key);
  const leftOut = entryUnits(all) - entryUnits(keep);
  return have.length === 0
    ? { kind: 'add', entries: keep, leftOut }
    : { kind: 'ask', cartSource: have[0], entries: keep, leftOut };
}

/** A notice followed by how many items were left out (nothing added when none). */
export const withLeftOut = (text: string, leftOut: number) => (leftOut > 0 ? `${text} ${SELLER_RULE_WORDS.leftOut(leftOut)}` : text);
