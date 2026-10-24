import { db } from '../../database/connection.js';
import { orderingClock } from '../../utils/time.js';
import { resolveSellingPrice } from '../pricing/index.js';
import { effectivePrice } from '../catalog/catalog.offers.js';
import { windowFor, windowOpenAt, type AvailabilitySnapshot } from '../configuration/availability-windows.js';
import { liveBundleOffers, type SpendGiftOffer } from '../configuration/bundle-offers.js';
import { sellableFor } from '../inventory/sellable.js';
import { stockKeyOf } from '../inventory/stock-ledger.js';
import { computeBundles, type BundleLine, type BundleOutcome, type GiftInfo } from './bundle-pricing.js';
import { orderRepository, type CreateOrderData } from './order.repository.js';

type OrderLine = CreateOrderData['items'][number];

/** What a priced cart says about bundle offers (cart quote, coupon preview). */
export interface PricedBundles {
  /** Items subtotal before the offers (after product / category offers). */
  subtotal_before_bundles: number;
  /** Free units + gifts, LKR. */
  bundle_savings: number;
  bundle_applied: BundleOutcome['applied'];
  gift_items: Array<{ product_id: string; name: string; quantity: number; value_lkr: number; offer_id: string }>;
  bundle_progress: BundleOutcome['progress'];
  /** One per requested line, in request order. */
  lines: Array<{ product_id: string; variant_id: string | null; quantity: number; paid_quantity: number; free_quantity: number; unit_price: number }>;
}

export const noBundles = (subtotal: number, lines: PricedBundles['lines'] = []): PricedBundles => ({
  subtotal_before_bundles: subtotal,
  bundle_savings: 0,
  bundle_applied: [],
  gift_items: [],
  bundle_progress: null,
  lines,
});

/**
 * The gift of each live SPEND_GET_GIFT offer: its regular price and whether it can be given now (on
 * sale, inside its hours, not a product that needs a size, enough in stock on top of the cart).
 * Advisory - createOrderAtomic re-checks the stock under the lock and drops a gift that ran out.
 */
async function giftInfoFor(
  offers: readonly SpendGiftOffer[],
  cartItems: readonly OrderLine[],
  availability: AvailabilitySnapshot
): Promise<Map<string, GiftInfo>> {
  const out = new Map<string, GiftInfo>();
  if (offers.length === 0) return out;
  const ids = [...new Set(offers.map((o) => o.gift_product_id))];
  const products = new Map((await orderRepository.findProductsByIds(ids)).map((p) => [p.id, p]));
  const catalog = await orderRepository.findCategoryOffers(ids);
  const defaultMarkup = await orderRepository.getDefaultMarkup();
  const store = await orderRepository.findActiveDarkStore();
  const sellable = store ? await sellableFor(db, store.id, ids.map((id) => ({ product_id: id, variant_id: null }))) : new Map();
  const demand = new Map<string, number>();
  for (const it of cartItems) {
    const k = stockKeyOf({ product_id: it.product_id, variant_id: it.variant_id ?? null });
    demand.set(k, (demand.get(k) ?? 0) + it.quantity);
  }
  const now = orderingClock.now();
  for (const offer of offers) {
    const prod = products.get(offer.gift_product_id);
    const row = catalog.get(offer.gift_product_id);
    if (!prod || (prod as { deleted_at?: Date | null }).deleted_at || !prod.is_active || !prod.is_available || !row || row.has_variants) continue;
    const window = windowFor(availability, { id: prod.id, category_id: prod.category_id });
    if (window && !windowOpenAt(window, now)) continue;
    const key = stockKeyOf({ product_id: prod.id, variant_id: null });
    const stock = sellable.get(key);
    if (stock && stock.sellable - (demand.get(key) ?? 0) < offer.gift_qty) continue;
    demand.set(key, (demand.get(key) ?? 0) + offer.gift_qty);
    const unit = resolveSellingPrice({
      purchaseCost: Number(prod.purchase_cost),
      pricingMode: prod.pricing_mode,
      fixedSellingPrice: prod.fixed_selling_price,
      productMarkupPercent: prod.custom_markup_percent,
      categoryMarkupPercent: row.category_markup_percent ?? null,
      parentCategoryMarkupPercent: row.parent_category_markup_percent ?? null,
      globalMarkupPercent: defaultMarkup,
      mrp: prod.mrp,
    });
    out.set(offer.id, {
      product_id: prod.id,
      name: prod.name,
      unit_price: effectivePrice({ ...prod, ...row }, unit.sellingPrice),
      available: true,
    });
  }
  return out;
}

/**
 * Applies the live bundle offers to the priced cart (bundle-pricing.ts has the rules): each free
 * unit becomes its own line at price 0 next to the paid units, each gift an extra price-0 line.
 * Without live offers (or before migration 062) the items come back untouched.
 * Called by priceCart, so the cart quote, the coupon preview and the order always agree.
 */
export async function applyBundles(ctx: {
  looseLines: readonly OrderLine[];
  comboItems: readonly OrderLine[];
  subtotalBefore: number;
  categoryOf: (productId: string) => string;
  availability: AvailabilitySnapshot;
}): Promise<{ items: OrderLine[]; subtotal: number; summary: PricedBundles }> {
  const { looseLines, comboItems, subtotalBefore } = ctx;
  const plainLines = looseLines.map((it) => ({
    product_id: it.product_id,
    variant_id: it.variant_id ?? null,
    quantity: it.quantity,
    paid_quantity: it.quantity,
    free_quantity: 0,
    unit_price: it.unit_selling_price,
  }));
  const offers = looseLines.length ? await liveBundleOffers() : [];
  if (offers.length === 0) {
    return { items: [...looseLines, ...comboItems], subtotal: subtotalBefore, summary: noBundles(subtotalBefore, plainLines) };
  }

  const categoryIds = [...new Set(looseLines.map((it) => ctx.categoryOf(it.product_id)))];
  const parents = new Map(
    (categoryIds.length ? await db.selectFrom('categories').select(['id', 'parent_id']).where('id', 'in', categoryIds).execute() : []).map((c) => [c.id, c.parent_id])
  );
  const lines: BundleLine[] = looseLines.map((it, index) => ({
    index,
    product_id: it.product_id,
    category_id: ctx.categoryOf(it.product_id),
    parent_category_id: parents.get(ctx.categoryOf(it.product_id)) ?? null,
    name: it.product_name_snapshot,
    unit_price: it.unit_selling_price,
    quantity: it.quantity,
  }));
  const spendOffers = offers.filter((o): o is SpendGiftOffer => o.type === 'SPEND_GET_GIFT');
  const gifts = await giftInfoFor(spendOffers, [...looseLines, ...comboItems], ctx.availability);
  const outcome = computeBundles(lines, subtotalBefore, offers, gifts);

  const items: OrderLine[] = [];
  const freeBy = new Map<number, typeof outcome.free>();
  for (const f of outcome.free) freeBy.set(f.line_index, [...(freeBy.get(f.line_index) ?? []), f]);
  looseLines.forEach((it, index) => {
    const frees = freeBy.get(index) ?? [];
    const freeQty = frees.reduce((n, f) => n + f.quantity, 0);
    const paid = it.quantity - freeQty;
    if (paid > 0) items.push({ ...it, quantity: paid, subtotal: Number((it.unit_selling_price * paid).toFixed(2)) });
    for (const f of frees) {
      const { offer } = f;
      items.push({
        ...it,
        unit_selling_price: 0,
        quantity: f.quantity,
        subtotal: 0,
        bundle: {
          offer_id: offer.id,
          kind: 'FREE_UNITS',
          title: offer.title,
          value: f.value,
          rule: { buy_qty: offer.buy_qty, get_qty: offer.get_qty, product_ids: offer.product_ids, category_id: offer.category_id },
        },
      });
      plainLines[index].free_quantity += f.quantity;
      plainLines[index].paid_quantity -= f.quantity;
    }
  });
  items.push(...comboItems);
  if (outcome.gifts.length > 0) {
    const giftProducts = new Map((await orderRepository.findProductsByIds(outcome.gifts.map((g) => g.gift.product_id))).map((p) => [p.id, p]));
    for (const g of outcome.gifts) {
      const prod = giftProducts.get(g.gift.product_id)!;
      items.push({
        product_id: prod.id,
        product_name_snapshot: prod.name,
        sku_snapshot: prod.sku,
        unit_snapshot: prod.unit,
        unit_selling_price: 0,
        estimated_unit_cost: Number(Number(prod.purchase_cost).toFixed(2)),
        markup_percentage_applied: 0,
        mrp_snapshot: null,
        quantity: g.quantity,
        subtotal: 0,
        bundle: { offer_id: g.offer.id, kind: 'GIFT', title: g.offer.title, value: g.value, rule: { min_subtotal: g.offer.min_subtotal, gift_qty: g.offer.gift_qty } },
      });
    }
  }

  const freeValue = outcome.free.reduce((n, f) => n + f.value, 0);
  return {
    items,
    subtotal: Number((subtotalBefore - freeValue).toFixed(2)),
    summary: {
      subtotal_before_bundles: subtotalBefore,
      bundle_savings: outcome.savings,
      bundle_applied: outcome.applied,
      gift_items: outcome.gifts.map((g) => ({ product_id: g.gift.product_id, name: g.gift.name, quantity: g.quantity, value_lkr: g.value, offer_id: g.offer.id })),
      bundle_progress: outcome.progress,
      lines: plainLines,
    },
  };
}
