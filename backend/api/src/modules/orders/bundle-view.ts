import type { BundleApplied } from './bundle-pricing.js';

/**
 * How an order shows its bundle offers (owner, 2026-10-25; migration 062). The offer lives on the
 * order's own item rows (a free unit or a gift is a price-0 line carrying bundle_*), so the order,
 * a later refund and a removed item always read the same facts. Rows from before 062 have no
 * bundle_* columns: every order then says bundle_savings 0.
 */
interface BundleRow {
  id?: string;
  product_id?: string;
  product_name_snapshot?: string;
  variant_label_snapshot?: string | null;
  quantity?: number;
  item_status?: string;
  bundle_offer_id?: string | null;
  bundle_kind?: 'FREE_UNITS' | 'GIFT' | null;
  bundle_title?: string | null;
  bundle_value?: unknown;
  bundle_rule?: unknown;
}

const round2 = (n: number) => Number(n.toFixed(2));
const value = (it: BundleRow) => round2(Number(it.bundle_value ?? 0));

/** An item row with the bundle fields the apps read (and without the internal rule snapshot). */
export function withBundleFields<T extends BundleRow>(it: T): Omit<T, 'bundle_rule'> & {
  is_bundle_free: boolean;
  bundle_kind: 'FREE_UNITS' | 'GIFT' | null;
  bundle_offer_id: string | null;
  bundle_title: string | null;
  bundle_value: number | null;
} {
  const { bundle_rule: _rule, ...rest } = it;
  const kind = it.bundle_kind ?? null;
  return {
    ...rest,
    is_bundle_free: kind !== null,
    bundle_kind: kind,
    bundle_offer_id: it.bundle_offer_id ?? null,
    bundle_title: it.bundle_title ?? null,
    bundle_value: kind !== null ? value(it) : null,
  };
}

/** bundle_savings, bundle_applied and gift_items of an order from its item rows (removed items do not count). */
export function bundleSummary(items: readonly BundleRow[] | undefined | null) {
  const rows = (items ?? []).filter((it) => it.bundle_kind && it.item_status !== 'UNAVAILABLE');
  const byOffer = new Map<string, BundleApplied>();
  const giftItems: Array<{ item_id: string | undefined; product_id: string | undefined; name: string; quantity: number; value_lkr: number; offer_id: string }> = [];
  let savings = 0;
  for (const it of rows) {
    const offerId = it.bundle_offer_id!;
    const v = value(it);
    savings = round2(savings + v);
    const entry = byOffer.get(offerId) ?? {
      offer_id: offerId,
      title: it.bundle_title ?? '',
      type: it.bundle_kind === 'GIFT' ? ('SPEND_GET_GIFT' as const) : ('BUY_X_GET_Y' as const),
      savings_lkr: 0,
    };
    entry.savings_lkr = round2(entry.savings_lkr + v);
    if (it.bundle_kind === 'FREE_UNITS') entry.free_units = (entry.free_units ?? 0) + (it.quantity ?? 0);
    if (it.bundle_kind === 'GIFT') {
      const name = it.variant_label_snapshot ? `${it.product_name_snapshot} ${it.variant_label_snapshot}` : (it.product_name_snapshot ?? '');
      entry.gift = { product_id: it.product_id ?? '', name, quantity: (entry.gift?.quantity ?? 0) + (it.quantity ?? 0), value_lkr: entry.savings_lkr };
      giftItems.push({ item_id: it.id, product_id: it.product_id, name, quantity: it.quantity ?? 0, value_lkr: v, offer_id: offerId });
    }
    byOffer.set(offerId, entry);
  }
  return { bundle_savings: savings, bundle_applied: [...byOffer.values()], gift_items: giftItems };
}

/** An order DTO with bundle_savings / bundle_applied / gift_items added (items untouched). */
export function withBundleSummary<T extends { items?: unknown }>(order: T) {
  return { ...order, ...bundleSummary(Array.isArray(order.items) ? (order.items as BundleRow[]) : []) };
}
