import { addressRepository } from './address.repository.js';
import { CreateAddressInput, UpdateAddressInput, UpdateProfileInput } from './address.schema.js';
import { AppError } from '../../middleware/error.middleware.js';
import { assertWithinServiceZone } from '../orders/delivery-zone.js';
import { db } from '../../database/connection.js';
import { birthdayOfferSettings } from '../configuration/settings.service.js';
import { birthdayOfferStatus, publicBirthdayStatus } from '../birthday/birthday.offer.js';
import { orderingClock } from '../../utils/time.js';

/**
 * Migration 024: the additional number exists so the rider has someone else
 * to call; the recipient's own number again adds nothing, so it is refused.
 */
function assertAlternateDiffers(recipientPhone: string | undefined, alternatePhone: string | null | undefined) {
  if (recipientPhone && alternatePhone && recipientPhone === alternatePhone) {
    throw new AppError(
      'Additional phone number must be different from the recipient phone number.',
      400,
      'ALTERNATE_PHONE_SAME_AS_RECIPIENT'
    );
  }
}

export class AddressService {
  async listAddresses(userId: string) {
    return await addressRepository.findActiveAddressesByUserId(userId);
  }

  async getAddressById(id: string, userId: string) {
    const address = await addressRepository.findAddressById(id, userId);
    if (!address) {
      throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
    }
    return address;
  }

  async createAddress(userId: string, input: CreateAddressInput) {
    assertAlternateDiffers(input.recipient_phone, input.alternate_phone);
    // Same service-zone rule as checkout: an address outside it could never
    // be ordered to, so it is refused when saved rather than at the cart.
    await assertWithinServiceZone(input.latitude, input.longitude);
    return await addressRepository.createAddress(userId, input);
  }

  async updateAddress(id: string, userId: string, input: UpdateAddressInput) {
    const phonesChange = input.recipient_phone !== undefined || input.alternate_phone !== undefined;
    const pinMoves = input.latitude !== undefined || input.longitude !== undefined;
    if (phonesChange || pinMoves) {
      // A partial update is checked against what the address will hold afterwards.
      const existing = await addressRepository.findAddressById(id, userId);
      if (!existing) {
        throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
      }
      assertAlternateDiffers(
        input.recipient_phone ?? existing.recipient_phone,
        input.alternate_phone !== undefined ? input.alternate_phone : existing.alternate_phone
      );
      if (pinMoves) {
        await assertWithinServiceZone(
          input.latitude ?? Number(existing.latitude),
          input.longitude ?? Number(existing.longitude)
        );
      }
    }
    const updated = await addressRepository.updateAddress(id, userId, input);
    if (!updated) {
      throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
    }
    return updated;
  }

  async deleteAddress(id: string, userId: string) {
    const deleted = await addressRepository.softDeleteAddress(id, userId);
    if (!deleted) {
      throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
    }
    return { success: true, message: 'Address deleted successfully' };
  }

  async setDefaultAddress(id: string, userId: string) {
    const defaultAddress = await addressRepository.setDefaultAddress(id, userId);
    if (!defaultAddress) {
      throw new AppError('Delivery address not found.', 404, 'ADDRESS_NOT_FOUND');
    }
    return defaultAddress;
  }

  async getProfile(userId: string) {
    const user = await addressRepository.findUserById(userId);
    if (!user) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }
    // Migration 034 (owner, 2026-10-09): the optional profile and where the
    // customer stands with the birthday gift (the app's banner).
    const [favourites, birthday] = await Promise.all([
      addressRepository.findLiveCategories(user.favourite_category_ids ?? []),
      birthdayOfferSettings.read().then((setting) => birthdayOfferStatus(db, userId, setting, orderingClock.now())),
    ]);
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      is_active: user.is_active,
      created_at: user.created_at,
      sms_language: user.sms_language,
      sms_offers: user.sms_offers_opted_out_at === null,
      date_of_birth: (user.date_of_birth as string | null) ?? null,
      favourite_category_ids: favourites.map((c) => c.id),
      favourite_categories: favourites,
      favourites_note: user.favourites_note ?? null,
      birthday_offer: publicBirthdayStatus(birthday),
    };
  }

  /** PATCH /me: only the fields sent change; answers with the full profile, like GET /me. */
  async updateProfile(userId: string, input: UpdateProfileInput) {
    if (input.favourite_category_ids?.length) {
      const live = await addressRepository.findLiveCategories(input.favourite_category_ids);
      const known = new Set(live.map((c) => c.id));
      const unknown = input.favourite_category_ids.filter((id) => !known.has(id));
      if (unknown.length) {
        throw new AppError('One or more of those categories no longer exist.', 400, 'UNKNOWN_CATEGORY', { category_ids: unknown });
      }
    }
    const updated = await addressRepository.updateUserProfile(userId, input);
    if (!updated) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }
    return await this.getProfile(userId);
  }
}

export const addressService = new AddressService();
