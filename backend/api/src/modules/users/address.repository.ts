import { db } from '../../database/connection.js';
import { CreateAddressInput, UpdateAddressInput } from './address.schema.js';

export class AddressRepository {
  /**
   * Retrieves all non-deleted delivery addresses for a customer.
   */
  async findActiveAddressesByUserId(userId: string) {
    return await db
      .selectFrom('customer_addresses')
      .selectAll()
      .where('user_id', '=', userId)
      .where('is_deleted', '=', false)
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'desc')
      .execute();
  }

  /**
   * Retrieves a single delivery address by ID, enforcing customer ownership.
   */
  async findAddressById(id: string, userId: string) {
    return await db
      .selectFrom('customer_addresses')
      .selectAll()
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('is_deleted', '=', false)
      .executeTakeFirst();
  }

  /**
   * Creates a new customer address, optionally making it the default.
   */
  async createAddress(userId: string, data: CreateAddressInput) {
    return await db.transaction().execute(async (trx) => {
      if (data.is_default) {
        await trx
          .updateTable('customer_addresses')
          .set({ is_default: false, updated_at: new Date() })
          .where('user_id', '=', userId)
          .execute();
      }

      const [record] = await trx
        .insertInto('customer_addresses')
        .values({
          user_id: userId,
          label: data.label,
          recipient_name: data.recipient_name,
          recipient_phone: data.recipient_phone,
          address_line1: data.address_line1,
          address_line2: data.address_line2 ?? null,
          city: data.city,
          postal_code: data.postal_code ?? null,
          latitude: data.latitude,
          longitude: data.longitude,
          delivery_instructions: data.delivery_instructions ?? null,
          is_default: data.is_default ?? false,
          is_deleted: false,
        })
        .returningAll()
        .execute();

      return record;
    });
  }

  /**
   * Updates an existing customer address.
   */
  async updateAddress(id: string, userId: string, data: UpdateAddressInput) {
    return await db.transaction().execute(async (trx) => {
      if (data.is_default) {
        await trx
          .updateTable('customer_addresses')
          .set({ is_default: false, updated_at: new Date() })
          .where('user_id', '=', userId)
          .where('id', '!=', id)
          .execute();
      }

      const [record] = await trx
        .updateTable('customer_addresses')
        .set({
          ...(data.label !== undefined ? { label: data.label } : {}),
          ...(data.recipient_name !== undefined ? { recipient_name: data.recipient_name } : {}),
          ...(data.recipient_phone !== undefined ? { recipient_phone: data.recipient_phone } : {}),
          ...(data.address_line1 !== undefined ? { address_line1: data.address_line1 } : {}),
          ...(data.address_line2 !== undefined ? { address_line2: data.address_line2 } : {}),
          ...(data.city !== undefined ? { city: data.city } : {}),
          ...(data.postal_code !== undefined ? { postal_code: data.postal_code } : {}),
          ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
          ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
          ...(data.delivery_instructions !== undefined
            ? { delivery_instructions: data.delivery_instructions }
            : {}),
          ...(data.is_default !== undefined ? { is_default: data.is_default } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('is_deleted', '=', false)
        .returningAll()
        .execute();

      return record || null;
    });
  }

  /**
   * Soft-deletes a customer address.
   */
  async softDeleteAddress(id: string, userId: string) {
    const [record] = await db
      .updateTable('customer_addresses')
      .set({
        is_deleted: true,
        is_default: false,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .where('is_deleted', '=', false)
      .returningAll()
      .execute();

    return record || null;
  }

  /**
   * Sets a specific address as default for the customer.
   */
  async setDefaultAddress(id: string, userId: string) {
    return await db.transaction().execute(async (trx) => {
      // Unset all existing defaults
      await trx
        .updateTable('customer_addresses')
        .set({ is_default: false, updated_at: new Date() })
        .where('user_id', '=', userId)
        .execute();

      // Set target address as default
      const [record] = await trx
        .updateTable('customer_addresses')
        .set({ is_default: true, updated_at: new Date() })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .where('is_deleted', '=', false)
        .returningAll()
        .execute();

      return record || null;
    });
  }

  /**
   * User profile operations
   */
  async findUserById(id: string) {
    return await db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async updateUserProfile(id: string, data: { full_name?: string; email?: string }) {
    const [record] = await db
      .updateTable('users')
      .set({
        ...(data.full_name !== undefined ? { full_name: data.full_name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .execute();

    return record || null;
  }
}

export const addressRepository = new AddressRepository();
