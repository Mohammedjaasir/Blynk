import { z } from 'zod';
import { db } from '../../database/connection.js';
import { logger } from '../../utils/logger.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';

/**
 * Cart rules (owner's brother, 2026-10-27: "Option A - one seller per order").
 *
 * system_configurations 'cart_rules' (no migration):
 *   { "one_seller_per_order": { "enabled": true } }
 *
 * ON when there is no row (owner: "switched ON for now"). With the rule on, a cart / order may hold
 * the items of only one seller, or only Blynk's own products: the customer app asks to start a new
 * cart, and POST /orders refuses a mixed order (422 MIXED_SELLERS_NOT_ALLOWED, orders/order-sources.ts).
 * The shape is an object per rule so a later rule ("mixed carts for sellers within X km", Option B)
 * can sit beside it; a write keeps any key it does not know.
 *
 * GET|PATCH /admin/settings/cart-rules (ADMIN, OPERATIONS; audited CART_RULES_UPDATED); GET /store
 * carries the effective value as `one_seller_per_order`.
 */
export const CART_RULES_KEY = 'cart_rules';

export interface CartRules {
  one_seller_per_order: { enabled: boolean };
}

export const DEFAULT_CART_RULES: CartRules = { one_seller_per_order: { enabled: true } };

export const updateCartRulesSchema = z
  .object({
    one_seller_per_order: z
      .object({
        enabled: z.boolean({ required_error: 'enabled is required', invalid_type_error: 'enabled must be true or false' }),
      })
      .strict(),
  })
  .strict();
export type UpdateCartRulesInput = z.infer<typeof updateCartRulesSchema>;

/** The stored row as the rules; anything missing or malformed keeps its default (so: ON). */
export function cartRulesFrom(value: unknown): CartRules {
  const out: CartRules = { one_seller_per_order: { ...DEFAULT_CART_RULES.one_seller_per_order } };
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      parsed = null;
    }
  }
  if (parsed && typeof parsed === 'object') {
    const rule = (parsed as Record<string, unknown>).one_seller_per_order;
    if (rule && typeof rule === 'object' && typeof (rule as Record<string, unknown>).enabled === 'boolean') {
      out.one_seller_per_order.enabled = (rule as { enabled: boolean }).enabled;
    }
  }
  return out;
}

const asObject = (value: unknown): Record<string, unknown> => {
  let v = value;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
};

export class CartRulesService {
  async get(): Promise<CartRules & { updated_at: Date | null }> {
    const row = await db
      .selectFrom('system_configurations')
      .select(['value', 'updated_at'])
      .where('key', '=', CART_RULES_KEY)
      .executeTakeFirst();
    return { ...cartRulesFrom(row?.value), updated_at: row?.updated_at ?? null };
  }

  /** The rules alone (what order placement and GET /store read). Never throws: a read failure means the default (ON). */
  async read(): Promise<CartRules> {
    const { updated_at: _at, ...rules } = await this.get();
    return rules;
  }

  /** Audited (CART_RULES_UPDATED); applies to orders placed afterwards. */
  async set(input: UpdateCartRulesInput, actor: AuditActor) {
    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('system_configurations')
        .select('value')
        .where('key', '=', CART_RULES_KEY)
        .forUpdate()
        .executeTakeFirst();
      const previous = cartRulesFrom(before?.value);
      // Keep keys this version does not know (a later rule), replace the ones it does.
      const next = { ...asObject(before?.value), one_seller_per_order: { enabled: input.one_seller_per_order.enabled } };
      const value = JSON.stringify(next);
      await trx
        .insertInto('system_configurations')
        .values({ key: CART_RULES_KEY, value, description: 'Cart rules: one seller per order on/off' })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: new Date() }))
        .execute();
      await writeAudit(trx, actor, {
        action: 'CART_RULES_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues: { key: CART_RULES_KEY, ...(before ? previous : {}) },
        newValues: { key: CART_RULES_KEY, one_seller_per_order: { enabled: input.one_seller_per_order.enabled } },
      });
      logger.info({ previous, enabled: input.one_seller_per_order.enabled, actorId: actor.actorId }, 'Cart rules changed');
    });
    return this.get();
  }
}

export const cartRulesService = new CartRulesService();
