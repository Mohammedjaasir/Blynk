import { z } from 'zod';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { earliestDeliveryDay } from '../../utils/store-hours.js';

/**
 * Delivery lead time (migration 045; owner, 2026-10-14): "in future if we add
 * items that can only be delivered after two days or some days we need that
 * option".
 *
 * products.delivery_lead_days (0..30, default 0; variants inherit their
 * product's). A cart's lead time is the LONGEST of its items' (loose and
 * combo). With a lead time of N > 0 days:
 *   - "as soon as possible" is refused (422 LEAD_TIME_REQUIRES_SLOT);
 *   - only a delivery slot starting on/after today + N (Colombo) is offered
 *     and accepted (GET /orders/slots?product_ids=... lists exactly those;
 *     422 SLOT_BEFORE_LEAD_TIME otherwise).
 * GET /orders/slots and GET /orders/checkout-info answer with lead_days and
 * earliest_delivery_date so the app can show "Delivered from <date>".
 */

export interface CartLead {
  lead_days: number;
  /** The product that sets the lead time (the longest), for the message. */
  product_name: string | null;
}

/** The longest lead time of these products (0 when none has one). */
export async function leadForProducts(productIds: readonly string[]): Promise<CartLead> {
  const ids = [...new Set(productIds)];
  if (ids.length === 0) return { lead_days: 0, product_name: null };
  const row = await db
    .selectFrom('products')
    .select(['name', 'delivery_lead_days'])
    .where('id', 'in', ids)
    .orderBy('delivery_lead_days', 'desc')
    .orderBy('name', 'asc')
    .limit(1)
    .executeTakeFirst();
  const days = Number(row?.delivery_lead_days ?? 0);
  return { lead_days: days, product_name: days > 0 ? row!.name : null };
}

/** The products a cart holds: loose lines plus every combo's items. */
export async function leadForCart(items: ReadonlyArray<{ product_id: string }>, combos: ReadonlyArray<{ combo_id: string }> = []): Promise<CartLead> {
  const ids = items.map((i) => i.product_id);
  if (combos.length) {
    const rows = await db
      .selectFrom('combo_items')
      .select('product_id')
      .where(
        'combo_id',
        'in',
        combos.map((c) => c.combo_id)
      )
      .execute();
    ids.push(...rows.map((r) => r.product_id));
  }
  return await leadForProducts(ids);
}

/** What the slots/checkout-info answers carry about the lead time. */
export function leadInfo(now: Date, lead: CartLead) {
  const earliest = earliestDeliveryDay(now, lead.lead_days);
  return {
    lead_days: lead.lead_days,
    earliest_delivery_date: earliest.date,
    earliest_delivery_label: earliest.label,
    asap_allowed: lead.lead_days === 0,
  };
}

/** ASAP with lead-time items in the cart. */
export function leadTimeRequiresSlotError(now: Date, lead: CartLead, slotsEnabled: boolean): AppError {
  const earliest = earliestDeliveryDay(now, lead.lead_days);
  const what = lead.product_name ? `'${lead.product_name}'` : 'An item in your basket';
  return new AppError(
    slotsEnabled
      ? `${what} can be delivered from ${earliest.label}. Please pick a delivery slot on or after that day.`
      : `${what} can be delivered from ${earliest.label}, but scheduled delivery is not available right now. Please remove it to order now.`,
    422,
    'LEAD_TIME_REQUIRES_SLOT',
    { lead_days: lead.lead_days, earliest_delivery_date: earliest.date, slots_enabled: slotsEnabled }
  );
}

/** A slot earlier than today + lead days. */
export function slotBeforeLeadTimeError(now: Date, lead: CartLead): AppError {
  const earliest = earliestDeliveryDay(now, lead.lead_days);
  const what = lead.product_name ? `'${lead.product_name}'` : 'An item in your basket';
  return new AppError(
    `${what} can be delivered from ${earliest.label}. Please pick a delivery slot on or after that day.`,
    422,
    'SLOT_BEFORE_LEAD_TIME',
    { lead_days: lead.lead_days, earliest_delivery_date: earliest.date }
  );
}

/** ?product_ids=a,b,c (comma-separated, at most 100) or ?lead_days=N, for slots/checkout-info. */
export const leadQuerySchema = z.object({
  product_ids: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []))
    .pipe(z.array(z.string().uuid('product_ids must be product ids, comma-separated')).max(100, 'At most 100 product ids')),
  lead_days: z.coerce.number().int('lead_days must be whole days').min(0).max(30).optional(),
});

/** The lead time a slots/checkout-info request asks about: the larger of the products' and lead_days. */
export async function leadFromQuery(query: z.infer<typeof leadQuerySchema>): Promise<CartLead> {
  const fromProducts = await leadForProducts(query.product_ids);
  const asked = query.lead_days ?? 0;
  return asked > fromProducts.lead_days ? { lead_days: asked, product_name: null } : fromProducts;
}
