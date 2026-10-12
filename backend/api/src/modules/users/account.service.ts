import { randomBytes } from 'node:crypto';
import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import type { OrderStatus } from '../../database/types.js';
import { riderDocumentService } from '../riders/rider.documents.js';
import { riderDocumentStore } from '../riders/rider.documents.files.js';
import { phoneHash } from './phone-identity.js';

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
 * match it and the number can register again as a new customer - who
 * inherits this account's promotion usage through users.phone_hash
 * (migration 041, users/phone-identity.ts).
 */
function deletedPhonePlaceholder(): string {
  return `del:${randomBytes(8).toString('hex')}`;
}

/**
 * DELETE /me (CUSTOMER only): anonymise and deactivate the account. Orders
 * are kept for accounting; addresses, device tokens and sessions are removed.
 */
export async function deleteCustomerAccount(userId: string, actor: AuditActor): Promise<{ deleted: true }> {
  // Rider documents (migration 039; owner, 2026-10-10): removed with the
  // account; their private files go once the deletion is committed.
  let riderDocumentIds: string[] = [];
  const result = await db.transaction().execute(async (trx) => {
    const user = await trx
      .selectFrom('users')
      .select(['id', 'role', 'is_active', 'phone', 'phone_hash'])
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

    riderDocumentIds = await riderDocumentService.deleteForUser(trx, userId, user.phone);
    // A waiting or rejected rider application goes with the account, so a
    // later approval cannot bring the account back as an active RIDER, and
    // its details leave the review queue (security audit 2026-10). A row
    // with deliveries or cash records (never expected for a CUSTOMER) is
    // kept - approval refuses a switched-off account anyway.
    const ridersRemoved = await trx
      .deleteFrom('riders')
      .where('user_id', '=', userId)
      .where('approval_status', '!=', 'APPROVED')
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('deliveries').select('deliveries.id').whereRef('deliveries.rider_id', '=', 'riders.id')))
      )
      .where(({ not, exists, selectFrom }) =>
        not(exists(selectFrom('cash_handins').select('cash_handins.id').whereRef('cash_handins.rider_id', '=', 'riders.id')))
      )
      .executeTakeFirst();

    const now = new Date();

    // Dental bookings (owner, 2026-10-12): upcoming HELD/CONFIRMED ones are
    // cancelled as the customer's own cancellation - no SMS to the patient -
    // and the patient's name, phone and notes are removed from every one of
    // their appointments (the in-app promise: name and phone are removed).
    const upcoming = await trx
      .selectFrom('appointments')
      .select(['id', 'status'])
      .where('customer_id', '=', userId)
      .where('status', 'in', ['HELD', 'CONFIRMED'])
      .where('start_at', '>', now)
      .forUpdate()
      .execute();
    if (upcoming.length) {
      await trx
        .updateTable('appointments')
        .set({
          status: 'CANCELLED_BY_CUSTOMER',
          held_until: null,
          cancelled_by: userId,
          cancellation_reason: 'Account deleted',
          updated_at: now,
        })
        .where(
          'id',
          'in',
          upcoming.map((a) => a.id)
        )
        .execute();
      await trx
        .insertInto('appointment_status_history')
        .values(
          upcoming.map((a) => ({
            appointment_id: a.id,
            old_status: a.status,
            new_status: 'CANCELLED_BY_CUSTOMER' as const,
            changed_by: userId,
          }))
        )
        .execute();
    }
    await trx
      .updateTable('appointments')
      .set({ patient_name: null, patient_phone: null, patient_notes: null, updated_at: now })
      .where('customer_id', '=', userId)
      .where((eb) => eb.or([eb('patient_name', 'is not', null), eb('patient_phone', 'is not', null), eb('patient_notes', 'is not', null)]))
      .execute();
    await trx
      .updateTable('users')
      .set({
        is_active: false,
        full_name: null,
        email: null,
        phone: deletedPhonePlaceholder(),
        // Migration 041 (security audit 2026-10): the number is freed but its
        // keyed hash stays, so a new account on the same number inherits this
        // one's promotion usage (coupons, free deliveries, birthday gift,
        // referral) instead of getting every perk again.
        phone_hash: phoneHash(user.phone) ?? user.phone_hash,
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
        rider_documents_removed: riderDocumentIds.length,
        rider_applications_removed: Number(ridersRemoved.numDeletedRows),
        appointments_cancelled: upcoming.length,
      },
    });

    return { deleted: true as const };
  });
  await riderDocumentStore.removeDocumentsQuietly(riderDocumentIds);
  return result;
}
