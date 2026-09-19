import { riderRepository } from './rider.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import type { RiderDeliveryStatus } from './rider.schema.js';
import { runTransition } from '../orders/lifecycle/engine.js';
import type { ActionName } from '../orders/lifecycle/catalogue.js';
import type { CodSettlement } from '../orders/lifecycle/settlement.js';

const RIDER_STEP: Record<RiderDeliveryStatus, ActionName> = {
  PICKED_UP: 'RIDER_PICKUP',
  ARRIVED_AT_CUSTOMER: 'RIDER_ARRIVE',
  FAILED: 'RIDER_FAIL',
};

export class RiderService {
  private async getRiderOrThrow(userId: string) {
    const rider = await riderRepository.findRiderByUserId(userId);
    if (!rider) {
      throw new AppError('Rider profile not found for this user account.', 403, 'RIDER_PROFILE_NOT_FOUND');
    }
    if (!rider.is_active) {
      throw new AppError('This rider profile is inactive.', 403, 'RIDER_INACTIVE');
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

  /**
   * Rider steps are lifecycle actions (#6 RIDER_PICKUP, #7 RIDER_ARRIVE,
   * #8 RIDER_FAIL): ownership, state and precedence are checked under the
   * delivery -> order locks.
   */
  async updateDeliveryStatus(
    deliveryId: string,
    userId: string,
    newStatus: RiderDeliveryStatus,
    failureReason?: string
  ) {
    const rider = await this.getRiderOrThrow(userId);
    await runTransition(RIDER_STEP[newStatus], {
      actor: { id: userId, role: 'RIDER' },
      deliveryId,
      riderId: rider.id,
      input: { failure_reason: failureReason },
    });
    return await riderRepository.findDeliveryById(deliveryId, rider.id);
  }

  /** Lifecycle #9 RIDER_COLLECT_COD, settled by the shared COD settlement. */
  async collectCod(deliveryId: string, userId: string, amount: number) {
    const rider = await this.getRiderOrThrow(userId);
    return await runTransition<CodSettlement>('RIDER_COLLECT_COD', {
      actor: { id: userId, role: 'RIDER' },
      deliveryId,
      riderId: rider.id,
      input: { amount },
    });
  }
}

export const riderService = new RiderService();
