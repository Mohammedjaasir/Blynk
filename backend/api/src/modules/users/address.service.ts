import { addressRepository } from './address.repository.js';
import { CreateAddressInput, UpdateAddressInput, UpdateProfileInput } from './address.schema.js';
import { AppError } from '../../middleware/error.middleware.js';

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
    return await addressRepository.createAddress(userId, input);
  }

  async updateAddress(id: string, userId: string, input: UpdateAddressInput) {
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
    };
  }
}

export const addressService = new AddressService();
