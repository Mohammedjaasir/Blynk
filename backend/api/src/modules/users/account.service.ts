import { randomBytes } from 'node:crypto';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import type { OrderStatus } from '../../database/types.js';

/**
 * Orders in these states are finished; anything else (PLACED, PACKED,
 * OUT_FOR_DELIVERY, ITEM_UNAVAILABLE, CUSTOMER_UNAVAILABLE) is still open
 * and blocks deleting the account.
 */
export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['DELIVERED', 'CANCELLED', 'FAILED'];

/**
 * users.phone is VARCHAR(20), UNIQUE, NOT NULL. A deleted account keeps its
 * row (orders reference it for accounting) but frees the number with a
 * placeholder like "del:1a2b3c4d5e6f7a8b" (20 chars). Every sign-in path
 * normalises the number to +94XXXXXXXXX first, so an OTP lookup can never
 * match it and the number can register again as a new customer.
 */
function deletedPhonePlaceholder(): string {
  return `del:${randomBytes(8).toString('hex')}`;
}

/**
 * DELETE /me (CUSTOMER only): anonymise and deactivate the account. Orders
 * are kept for accounting; addresses, device tokens and sessions are removed.
 */
export async function deleteCustomerAccount(userId: string, actor: AuditActor): Promise<{ deleted: true }> {
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom('users')
      .select(['id', 'role', 'is_active'])
      .where('id', '=', userId)
      .forUpdate()
      .executeTakeFirst();
    if (!user || !user.is_active) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }
    if (user.role !== 'CUSTOMER') {
      throw new AppError('Only customer accounts can be deleted here.', 403, 'FORBIDDEN');
    }

    const open = await trx
      .selectFrom('orders')
      .select(({ fn }) => fn.countAll<string>().as('n'))
      .where('customer_id', '=', userId)
      .where('order_status', 'not in', [...FINAL_ORDER_STATUSES])
      .executeTakeFirstOrThrow();
    if (Number(open.n) > 0) {
      throw new AppError('Finish or cancel your open orders first.', 409, 'ACTIVE_ORDERS_EXIST', {
        open_orders: Number(open.n),
      });
    }

    const now = new Date();
    await trx
      .updateTable('users')
      .set({
        is_active: false,
        full_name: null,
        email: null,
        phone: deletedPhonePlaceholder(),
        sms_offers_opted_out_at: now,
        // Migration 034: the optional profile is personal too.
        date_of_birth: null,
        favourite_category_ids: [],
        favourites_note: null,
        updated_at: now,
      })
      .where('id', '=', userId)
      .execute();

    // No table references customer_addresses (orders snapshot the address),
    // so the rows and the personal details in them are removed outright.
    const addresses = await trx.deleteFrom('customer_addresses').where('user_id', '=', userId).executeTakeFirst();
    const devices = await trx.deleteFrom('device_tokens').where('user_id', '=', userId).executeTakeFirst();
    // "Notify me when back in stock" subscriptions would otherwise still message the old number.
    await trx.deleteFrom('stock_alerts').where('user_id', '=', userId).execute();
    await trx
      .updateTable('refresh_tokens')
      .set({ revoked_at: now })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute();

    await writeAudit(trx, actor, {
      action: 'CUSTOMER_ACCOUNT_DELETED',
      entityType: 'user',
      entityId: userId,
      newValues: {
        is_active: false,
        addresses_removed: Number(addresses.numDeletedRows),
        devices_removed: Number(devices.numDeletedRows),
      },
    });

    return { deleted: true as const };
  });
}
