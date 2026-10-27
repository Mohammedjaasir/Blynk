import type { Combo, Product } from '../api/types';
import { MAX_COMBO_QTY, MAX_QTY, lineKey, type CartLine, type CartVariant, type ComboLine } from './cartStore';
import { cartSources, planAdd, sourceName, sourceOf, type AddEntry } from './sellerRule';
import { SELLER_RULE_WORDS } from './sellerWords';
import type { NewCartPrompt } from './startNewCart';

/*
 * The one place every add goes through (src/lib/cart.tsx wires the real cart in): with the
 * "one seller per order" rule on, an add that would bring a NEW source into a non-empty cart is held
 * and the customer is asked "Start a new cart?"; a bulk add (Add all, order again) asks once.
 * Everything the cart does is passed in, so this runs (and is tested) without React.
 */

export interface GuardDeps {
  rule: () => boolean;
  lines: () => CartLine[];
  combos: () => ComboLine[];
  /** Units (or packs) of that product line / size / combo in the cart right now. */
  qtyOf: (e: AddEntry) => number;
  /** Puts the entry's quantity on top of what is there (clamped by the cart). */
  apply: (e: AddEntry) => void;
  /** The customer's own "clear cart". */
  clear: () => void;
  /** Replaces the whole cart (the customer's own change). */
  replace: (lines: CartLine[], combos: ComboLine[]) => void;
  prompt: (p: NewCartPrompt) => void;
  notice: (text: string, tone?: 'info' | 'problem') => void;
}

export interface AddOutcome {
  /** Units (and packs) that actually went in. */
  addedUnits: number;
  /** Units from other sellers that were not added. */
  leftOut: number;
}

export function createSellerGuard(d: GuardDeps) {
  const run = (entries: AddEntry[], leftOut: number): AddOutcome => {
    let addedUnits = 0;
    for (const e of entries) {
      const before = d.qtyOf(e);
      d.apply(e);
      addedUnits += Math.max(0, d.qtyOf(e) - before);
    }
    return { addedUnits, leftOut };
  };

  return {
    /**
     * Add `entries` unless the rule needs an answer first. `onDone` hears what went in, now or after
     * "Clear cart and add" (never after "Keep current cart"); without it, items left out are announced
     * here. Returns 'asked' when the dialog is up.
     */
    attempt(entries: AddEntry[], onDone?: (o: AddOutcome) => void): 'added' | 'asked' {
      const plan = planAdd(d.lines(), d.combos(), entries, d.rule());
      const finish = (o: AddOutcome) => {
        if (onDone) onDone(o);
        else if (o.leftOut > 0) d.notice(SELLER_RULE_WORDS.leftOut(o.leftOut), 'info');
      };
      if (plan.kind === 'add') {
        finish(run(plan.entries, plan.leftOut));
        return 'added';
      }
      d.prompt({
        sellerName: sourceName(plan.cartSource),
        clearAndAdd: () => {
          d.clear();
          finish(run(plan.entries, plan.leftOut));
        },
        keep: () => undefined,
      });
      return 'asked';
    },

    /**
     * Checkout said MIXED_SELLERS_NOT_ALLOWED (a cart saved before the rule): keep only the first
     * source's items, tell how many went. Returns the units removed.
     */
    keepFirstSource(): number {
      const lines = d.lines();
      const combos = d.combos();
      const sources = cartSources(lines, combos);
      if (sources.length < 2) return 0;
      const first = sources[0];
      const keepLines = lines.filter((l) => sourceOf(l.product).key === first.key);
      const keepCombos = first.key === 'blynk' ? combos : [];
      const removed = lines.reduce((a, l) => a + l.quantity, 0) - keepLines.reduce((a, l) => a + l.quantity, 0)
        + (first.key === 'blynk' ? 0 : combos.reduce((a, c) => a + c.quantity, 0));
      d.replace(keepLines, keepCombos);
      d.notice(SELLER_RULE_WORDS.removed(removed), 'info');
      return removed;
    },
  };
}

/**
 * Collects the adds of a bulk action (Add all, order again) instead of doing them, handing back the
 * same "how many went in" answers the cart would have (its per-line and per-combo limits), so the
 * bulk code keeps working unchanged; then the list goes through `attempt` once.
 */
export function collectEntries(qtyOfLine: (key: string) => number, qtyOfCombo: (id: string) => number) {
  const entries: AddEntry[] = [];
  const pendingLine = new Map<string, number>();
  const pendingCombo = new Map<string, number>();
  return {
    entries,
    addProduct(p: Product, n: number, variant?: CartVariant | null): number {
      const key = lineKey(p.id, variant?.id);
      const room = MAX_QTY - qtyOfLine(key) - (pendingLine.get(key) ?? 0);
      const take = Math.max(0, Math.min(Math.floor(n), room));
      if (take > 0) {
        pendingLine.set(key, (pendingLine.get(key) ?? 0) + take);
        entries.push({ kind: 'product', product: p, variant, quantity: take });
      }
      return take;
    },
    addCombo(combo: Combo): void {
      const room = MAX_COMBO_QTY - qtyOfCombo(combo.id) - (pendingCombo.get(combo.id) ?? 0);
      if (room <= 0) return;
      pendingCombo.set(combo.id, (pendingCombo.get(combo.id) ?? 0) + 1);
      entries.push({ kind: 'combo', combo, quantity: 1 });
    },
    comboQty: (id: string) => qtyOfCombo(id) + (pendingCombo.get(id) ?? 0),
  };
}
