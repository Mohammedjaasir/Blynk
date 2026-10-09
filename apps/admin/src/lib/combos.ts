import type { AdminProduct, Combo, ComboNotLiveReason, OrderCombo, OrderItemRow } from '../api/types';
import { colomboDate } from './coupons';

/**
 * Category offers and combo packs (owner, 2026-10-09; migration 033). The
 * backend is the authority on both; these helpers preview and pre-check so
 * the owner sees a problem before saving.
 */

// --------------------------------------------------------- category offers
/** The offer runs to the end of the picked day in Colombo. */
export const endOfDay = (date: string) => `${date}T23:59:59+05:30`;

const PERCENT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * The category offer form's checks, mirroring the API: more than 0 and less
 * than 100 percent, at most 2 decimals, and a changed end day not in the past.
 */
export function validateCategoryOffer(
  percent: string,
  endsOn: string,
  storedEndsOn: string,
  today: string = colomboDate()
): { percent?: string; endsOn?: string } {
  const errors: { percent?: string; endsOn?: string } = {};
  const value = Number(percent.trim());
  if (!PERCENT_PATTERN.test(percent.trim()) || !(value > 0 && value < 100)) {
    errors.percent = 'Enter a % above 0 and below 100, with at most 2 decimals';
  }
  if (endsOn && endsOn !== storedEndsOn && endsOn < today) {
    errors.endsOn = 'Pick today or a later day';
  }
  return errors;
}

// ------------------------------------------------------------- combo packs
/** Why a combo is hidden, in plain words. */
export const NOT_LIVE_LABEL: Record<ComboNotLiveReason, string> = {
  INACTIVE: 'Switched off',
  ENDED: 'Ended',
  ITEM_INACTIVE: 'A product is switched off',
  NOT_CHEAPER: 'Hidden: items are now cheaper than the combo',
};

/** The combo's status line for the list. */
export function comboStatus(combo: Pick<Combo, 'is_live' | 'is_available' | 'not_live_reason'>): {
  label: string;
  tone: 'active' | 'inactive' | 'muted';
} {
  if (!combo.is_live) {
    return { label: combo.not_live_reason ? NOT_LIVE_LABEL[combo.not_live_reason] : 'Not live', tone: 'inactive' };
  }
  if (!combo.is_available) return { label: 'Live · sold out', tone: 'muted' };
  return { label: 'Live', tone: 'active' };
}

/** What one unit of a product costs a customer today (offers included). */
export function productPrice(product: Pick<AdminProduct, 'customer_price' | 'calculated_selling_price' | 'selling_price'>): number {
  return Number(product.customer_price ?? product.calculated_selling_price ?? product.selling_price ?? 0);
}

const cents = (n: number) => Math.round(n * 100);

/** One pick in the combo form. */
export interface ComboPick {
  product_id: string;
  name: string;
  /** Unit price today, for the live summary. */
  unit_price: number;
  image_url: string | null;
  /** As typed. */
  quantity: string;
}

/** Sum of each pick's unit price x quantity (a quantity not yet valid counts as 0). */
export function itemsTotal(picks: ReadonlyArray<Pick<ComboPick, 'unit_price' | 'quantity'>>): number {
  const total = picks.reduce((sum, p) => {
    const q = Number(p.quantity);
    return sum + (Number.isInteger(q) && q > 0 ? cents(p.unit_price) * q : 0);
  }, 0);
  return total / 100;
}

const PRICE_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * Why the combo can't be saved yet, mirroring the API's rules: a name, at
 * least 2 products (or 1 with quantity 2+), whole quantities 1-100, and a
 * price above 0 and below the items' total. Empty = good to save.
 */
export function comboProblems(form: { name: string; price: string; picks: ReadonlyArray<ComboPick> }): string[] {
  const problems: string[] = [];
  if (form.name.trim().length < 2) problems.push('Give the combo a name (at least 2 characters).');
  const quantities = form.picks.map((p) => Number(p.quantity));
  if (quantities.some((q) => !Number.isInteger(q) || q < 1 || q > 100)) {
    problems.push('Each quantity must be a whole number from 1 to 100.');
  }
  const enough = form.picks.length >= 2 || (form.picks.length === 1 && quantities[0] >= 2);
  if (!enough) problems.push('Add at least 2 products, or 1 product with a quantity of 2 or more.');
  const price = Number(form.price.trim());
  if (!PRICE_PATTERN.test(form.price.trim()) || !(price > 0)) {
    problems.push('Enter a combo price above 0 with at most 2 decimals.');
  } else if (form.picks.length > 0 && cents(price) >= cents(itemsTotal(form.picks))) {
    problems.push('The combo price must be lower than the items bought separately.');
  }
  return problems;
}

// ------------------------------------------------------- orders with combos
/** One displayed item line; duplicate lines of a product within a combo are merged. */
export interface DisplayItem {
  key: string;
  /** The first underlying row (for actions such as Mark unavailable). */
  item: OrderItemRow;
  product_name_snapshot: string;
  quantity: number;
  item_status: OrderItemRow['item_status'];
}

export interface GroupedOrderItems {
  combos: Array<{ combo: OrderCombo; items: DisplayItem[] }>;
  loose: DisplayItem[];
}

const asDisplay = (item: OrderItemRow): DisplayItem => ({
  key: item.id,
  item,
  product_name_snapshot: item.product_name_snapshot,
  quantity: item.quantity,
  item_status: item.item_status,
});

/**
 * An order's items under their combo packs (items whose order_combo_id is
 * the combo line's id), then the loose items as before. Within one combo,
 * lines of the same product with the same status are shown as one (the API
 * may split a product to carry leftover cents).
 */
export function groupOrderItems(items: ReadonlyArray<OrderItemRow>, combos: ReadonlyArray<OrderCombo> = []): GroupedOrderItems {
  const comboIds = new Set(combos.map((c) => c.id));
  const grouped = combos.map((combo) => {
    const merged: DisplayItem[] = [];
    const byKey = new Map<string, DisplayItem>();
    for (const item of items) {
      if (item.order_combo_id !== combo.id) continue;
      const key = `${item.product_id ?? item.product_name_snapshot}|${item.item_status}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        const line = asDisplay(item);
        byKey.set(key, line);
        merged.push(line);
      }
    }
    return { combo, items: merged };
  });
  // An item pointing at a combo line the response did not include stays visible as loose.
  const loose = items.filter((i) => !i.order_combo_id || !comboIds.has(i.order_combo_id)).map(asDisplay);
  return { combos: grouped, loose };
}
