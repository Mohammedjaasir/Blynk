import { riderRepository } from './rider.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import { DeliveryAssignmentStatus } from '../../database/types.js';

export class RiderService {
  private async getRiderOrThrow(userId: string) {
    const rider = await riderRepository.findRiderByUserId(userId);
    if (!rider) {
      throw new AppError('Rider profile not found for this user account.', 403, 'RIDER_PROFILE_NOT_FOUND');
    }
    return rider;
  }

  async getActiveDeliveries(userId: string) {
    const rider = await this.getRiderOrThrow(userId);
    return await riderRepository.findActiveDeliveries(rider.id);
  }

  async getDeliveryById(deliveryId: string, userId: string) {
    const rider = await this.getRiderOrThrow(userId);
    const delivery = await riderRepository.findDeliveryById(deliveryId, rider.id);
    if (!delivery) {
      throw new AppError('Delivery assignment not found.', 404, 'DELIVERY_NOT_FOUND');
    }
    return delivery;
  }

  async updateDeliveryStatus(
    deliveryId: string,
    userId: string,
    newStatus: DeliveryAssignmentStatus,
    failureReason?: string
  ) {
    const rider = await this.getRiderOrThrow(userId);
    const updated = await riderRepository.updateDeliveryStatus(
      deliveryId,
      rider.id,
      newStatus,
      userId,
      failureReason
    );
    if (!updated) {
      throw new AppError('Delivery assignment not found.', 404, 'DELIVERY_NOT_FOUND');
    }
    return await riderRepository.findDeliveryById(deliveryId, rider.id);
  }

  async collectCod(deliveryId: string, userId: string, amount: number) {
    const rider = await this.getRiderOrThrow(userId);
    const delivery = await riderRepository.findDeliveryById(deliveryId, rider.id);
    if (!delivery) {
      throw new AppError('Delivery assignment not found.', 404, 'DELIVERY_NOT_FOUND');
    }

    if (Math.abs(amount - delivery.total_amount) > 0.01) {
      throw new AppError(
        `Collected cash amount (${amount.toFixed(2)} LKR) does not match total order amount (${delivery.total_amount.toFixed(2)} LKR).`,
        400,
        'INVALID_COD_AMOUNT',
        { expected_amount: delivery.total_amount, provided_amount: amount }
      );
    }

    const settlement = await riderRepository.collectCod(deliveryId, rider.id, amount, userId);
    return settlement;
  }
}

export const riderService = new RiderService();
