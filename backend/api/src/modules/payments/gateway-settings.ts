import { z } from 'zod';
import { db } from '../../database/connection.js';
import { env } from '../../config/env.js';
import { AppError } from '../../middleware/error.middleware.js';
import { logger } from '../../utils/logger.js';
import type { UserRole } from '../../database/types.js';
import { SETTINGS_ENTITY_ID, writeAudit, type AuditActor } from '../audit/audit.writer.js';
import { checkoutHash, formatPayHereAmount, PAYHERE_CHECKOUT_URLS, PAYHERE_CURRENCY, type PayHereMode } from './payhere.js';
import { decryptSecret, encryptSecret, paymentSecretKeyConfigured } from './secret-box.js';

/**
 * PayHere settings (migration 047; owner, 2026-10-14). One row in
 * payment_gateway_settings. Admin and Operations switch online payment on/off,
 * set the payment window and the accepted-methods note; the credentials
 * (mode, merchant id, merchant secret) are Admin only. The secret is stored
 * encrypted and never leaves the server: not in responses, logs or audit.
 */
export const PROVIDER = 'PAYHERE';
export const DEFAULT_WINDOW_MINUTES = 20;
const MASK = '••••••••';

export interface GatewayConfig {
  enabled: boolean;
  mode: PayHereMode;
  merchant_id: string | null;
  /** Decrypted; internal use only. Null when unset or unreadable. */
  merchant_secret: string | null;
  merchant_secret_set: boolean;
  merchant_secret_updated_at: Date | null;
  allowed_methods: string | null;
  payment_window_minutes: number;
  updated_at: Date | null;
}

const trimSlash = (u: string) => u.replace(/\/+$/, '');
const withSlash = (u: string) => (u.endsWith('/') ? u : `${u}/`);

export function payhereUrls(mode: PayHereMode) {
  return {
    checkout_url: PAYHERE_CHECKOUT_URLS[mode],
    notify_url: env.PAYHERE_NOTIFY_URL ?? `${trimSlash(env.PUBLIC_BASE_URL)}${env.API_PREFIX}/payments/payhere/notify`,
    return_url: env.PAYHERE_RETURN_URL ?? new URL('payment/return', withSlash(env.WEB_APP_URL)).toString(),
    cancel_url: env.PAYHERE_CANCEL_URL ?? new URL('payment/cancel', withSlash(env.WEB_APP_URL)).toString(),
  };
}

/** Whether online payment can actually be taken right now. */
export function isReady(c: GatewayConfig): boolean {
  return Boolean(c.merchant_id && c.merchant_secret && paymentSecretKeyConfigured());
}

export const updatePaymentGatewaySchema = z
  .object({
    enabled: z.boolean({ invalid_type_error: 'enabled must be true or false' }).optional(),
    allowed_methods: z.string().trim().max(200, 'Keep the accepted methods note under 200 characters').nullable().optional(),
    payment_window_minutes: z
      .number({ invalid_type_error: 'payment_window_minutes must be a number' })
      .int('Use whole minutes')
      .min(5, 'At least 5 minutes')
      .max(180, 'At most 180 minutes')
      .optional(),
    mode: z.enum(['sandbox', 'live'], { invalid_type_error: 'mode must be sandbox or live' }).optional(),
    merchant_id: z
      .string({ invalid_type_error: 'merchant_id must be text' })
      .trim()
      .regex(/^[0-9]{1,32}$/, 'The PayHere Merchant ID is digits only')
      .optional(),
    merchant_secret: z
      .string({ invalid_type_error: 'merchant_secret must be text' })
      .trim()
      .min(8, 'The merchant secret looks too short')
      .max(128, 'The merchant secret looks too long')
      .optional(),
  })
  .strict();
export type UpdatePaymentGatewayInput = z.infer<typeof updatePaymentGatewaySchema>;

const CREDENTIAL_FIELDS = ['mode', 'merchant_id', 'merchant_secret'] as const;

export const testHashSchema = z
  .object({
    order_id: z.string().trim().regex(/^[A-Za-z0-9-]{1,50}$/, 'Letters, digits and dashes only').optional(),
    amount: z.number().positive().max(1_000_000).optional(),
  })
  .strict();

async function readRow() {
  return await db.selectFrom('payment_gateway_settings').selectAll().where('provider', '=', PROVIDER).executeTakeFirst();
}

export const paymentGateway = {
  /** The live configuration, with the secret decrypted for internal use. */
  async read(): Promise<GatewayConfig> {
    const row = await readRow();
    if (!row) {
      return {
        enabled: false,
        mode: 'sandbox',
        merchant_id: null,
        merchant_secret: null,
        merchant_secret_set: false,
        merchant_secret_updated_at: null,
        allowed_methods: null,
        payment_window_minutes: DEFAULT_WINDOW_MINUTES,
        updated_at: null,
      };
    }
    return {
      enabled: row.enabled,
      mode: row.mode,
      merchant_id: row.merchant_id,
      merchant_secret: decryptSecret(row.merchant_secret_encrypted),
      merchant_secret_set: Boolean(row.merchant_secret_encrypted),
      merchant_secret_updated_at: row.merchant_secret_updated_at,
      allowed_methods: row.allowed_methods,
      payment_window_minutes: row.payment_window_minutes,
      updated_at: row.updated_at,
    };
  },
};

/** What customers learn (GET /store, checkout-info): never any credential. */
export async function publicOnlinePayment() {
  let c: GatewayConfig;
  try {
    c = await paymentGateway.read();
  } catch (err) {
    // Before migration 047 is applied the table does not exist: online
    // payment is simply off, and GET /store keeps working.
    if ((err as { code?: string }).code === '42P01') {
      return { enabled: false, provider: PROVIDER, methods_note: null, payment_window_minutes: DEFAULT_WINDOW_MINUTES };
    }
    throw err;
  }
  return {
    enabled: c.enabled && isReady(c),
    provider: PROVIDER,
    methods_note: c.allowed_methods,
    payment_window_minutes: c.payment_window_minutes,
  };
}

/** The staff view (Admin + Ops). The secret only as a mask. */
export function staffView(c: GatewayConfig, role: UserRole) {
  return {
    provider: PROVIDER,
    enabled: c.enabled,
    mode: c.mode,
    merchant_id: c.merchant_id,
    merchant_secret_set: c.merchant_secret_set,
    merchant_secret_masked: c.merchant_secret_set ? MASK : null,
    // Saved but unreadable with the current key (key changed): re-enter it.
    merchant_secret_readable: c.merchant_secret_set ? c.merchant_secret !== null : null,
    merchant_secret_updated_at: c.merchant_secret_updated_at,
    allowed_methods: c.allowed_methods,
    payment_window_minutes: c.payment_window_minutes,
    encryption_key_configured: paymentSecretKeyConfigured(),
    ready: isReady(c),
    ...payhereUrls(c.mode),
    can_edit_credentials: role === 'ADMIN',
    updated_at: c.updated_at,
  };
}

export const paymentGatewayService = {
  async get(role: UserRole) {
    return staffView(await paymentGateway.read(), role);
  },

  async update(input: UpdatePaymentGatewayInput, actor: AuditActor & { role: UserRole }) {
    const touchesCredentials = CREDENTIAL_FIELDS.some((f) => input[f] !== undefined);
    if (touchesCredentials && actor.role !== 'ADMIN') {
      throw new AppError('Only an Admin can change the PayHere credentials.', 403, 'CREDENTIALS_ADMIN_ONLY');
    }
    if (input.merchant_secret !== undefined && !paymentSecretKeyConfigured()) {
      throw new AppError(
        'The server has no PAYMENT_SECRET_KEY, so the merchant secret cannot be stored safely. Ask the developer to set it, then save the secret again.',
        422,
        'PAYMENT_SECRET_KEY_MISSING'
      );
    }

    await db.transaction().execute(async (trx) => {
      const before = await trx
        .selectFrom('payment_gateway_settings')
        .selectAll()
        .where('provider', '=', PROVIDER)
        .forUpdate()
        .executeTakeFirst();
      const now = new Date();
      const next = {
        enabled: input.enabled ?? before?.enabled ?? false,
        mode: input.mode ?? before?.mode ?? 'sandbox',
        merchant_id: input.merchant_id ?? before?.merchant_id ?? null,
        merchant_secret_encrypted:
          input.merchant_secret !== undefined ? encryptSecret(input.merchant_secret) : (before?.merchant_secret_encrypted ?? null),
        merchant_secret_updated_at: input.merchant_secret !== undefined ? now : (before?.merchant_secret_updated_at ?? null),
        allowed_methods:
          input.allowed_methods === undefined ? (before?.allowed_methods ?? null) : input.allowed_methods ? input.allowed_methods : null,
        payment_window_minutes: input.payment_window_minutes ?? before?.payment_window_minutes ?? DEFAULT_WINDOW_MINUTES,
      };
      if (next.enabled) {
        const secretReadable = next.merchant_secret_encrypted ? decryptSecret(next.merchant_secret_encrypted) !== null : false;
        if (!next.merchant_id || !secretReadable || !paymentSecretKeyConfigured()) {
          throw new AppError(
            'PayHere is not fully set up: save the Merchant ID and Merchant Secret (Admin) first.',
            422,
            'PAYHERE_NOT_CONFIGURED',
            {
              merchant_id_set: Boolean(next.merchant_id),
              merchant_secret_set: Boolean(next.merchant_secret_encrypted),
              encryption_key_configured: paymentSecretKeyConfigured(),
            }
          );
        }
      }
      await trx
        .insertInto('payment_gateway_settings')
        .values({ provider: PROVIDER, ...next, updated_by_user_id: actor.actorId, updated_at: now })
        .onConflict((oc) => oc.column('provider').doUpdateSet({ ...next, updated_by_user_id: actor.actorId, updated_at: now }))
        .execute();

      // Audit: what changed, never the secret (only "changed").
      const oldValues: Record<string, unknown> = { key: 'payment_gateway' };
      const newValues: Record<string, unknown> = { key: 'payment_gateway' };
      for (const f of ['enabled', 'mode', 'merchant_id', 'allowed_methods', 'payment_window_minutes'] as const) {
        if (input[f] !== undefined) {
          oldValues[f] = before ? before[f] : null;
          newValues[f] = next[f];
        }
      }
      if (input.merchant_secret !== undefined) {
        oldValues.merchant_secret = before?.merchant_secret_encrypted ? 'set' : 'not set';
        newValues.merchant_secret = 'changed';
      }
      await writeAudit(trx, actor, {
        action: 'PAYMENT_GATEWAY_UPDATED',
        entityType: 'SYSTEM_CONFIGURATION',
        entityId: SETTINGS_ENTITY_ID,
        oldValues,
        newValues,
      });
      // Field names only - no values, so nothing secret can reach the log.
      logger.info({ actorId: actor.actorId, fields: Object.keys(input) }, 'Payment gateway settings changed');
    });
    return await this.get(actor.role);
  },

  /** "Generate sample hash": proves the saved secret decrypts; calls nothing outside Blynk. */
  async testHash(input: z.infer<typeof testHashSchema>) {
    const c = await paymentGateway.read();
    if (!c.merchant_id || !c.merchant_secret) {
      throw new AppError(
        c.merchant_secret_set && !c.merchant_secret
          ? 'The saved merchant secret cannot be read with the server key. Enter the secret again.'
          : 'Save the PayHere Merchant ID and Merchant Secret first.',
        422,
        'PAYHERE_NOT_CONFIGURED'
      );
    }
    const orderId = input.order_id ?? 'TEST-0001';
    const amount = input.amount ?? 1000;
    return {
      mode: c.mode,
      merchant_id: c.merchant_id,
      order_id: orderId,
      amount: formatPayHereAmount(amount),
      currency: PAYHERE_CURRENCY,
      hash: checkoutHash({ merchantId: c.merchant_id, orderId, amount, currency: PAYHERE_CURRENCY, merchantSecret: c.merchant_secret }),
    };
  },
};
