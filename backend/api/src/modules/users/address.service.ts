import { addressRepository } from './address.repository.js';
import { CreateAddressInput, UpdateAddressInput, UpdateProfileInput } from './address.schema.js';
import { AppError } from '../../middleware/error.middleware.js';
import { assertWithinServiceZone } from '../orders/delivery-zone.js';

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
    };
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    const updated = await addressRepository.updateUserProfile(userId, input);
    if (!updated) {
      throw new AppError('User not found.', 404, 'USER_NOT_FOUND');
    }
    return {
      id: updated.id,
      phone: updated.phone,
      email: updated.email,
      full_name: updated.full_name,
      role: updated.role,
      sms_language: updated.sms_language,
      sms_offers: updated.sms_offers_opted_out_at === null,
    };
  }
}

export const addressService = new AddressService();
