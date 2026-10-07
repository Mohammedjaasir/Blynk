import { riderRepository } from './rider.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import type { RiderDeliveryStatus } from './rider.schema.js';
import { runTransition } from '../orders/lifecycle/engine.js';
import type { ActionName } from '../orders/lifecycle/catalogue.js';
import type { CodSettlement } from '../orders/lifecycle/settlement.js';
import type { Actor } from '../orders/lifecycle/types.js';

const RIDER_STEP: Record<RiderDeliveryStatus, ActionName> = {
  PICKED_UP: 'RIDER_PICKUP',
  ARRIVED_AT_CUSTOMER: 'RIDER_ARRIVE',
  FAILED: 'RIDER_FAIL',
};

/**
 * Who may be doing rider work: a RIDER, or the Operations app's ADMIN
 * operator (operations plan §2, §7). The role is carried through to the
 * lifecycle engine as the caller's *real* role, so the engine's own role
 * check stays a genuine second gate rather than a fabricated 'RIDER'.
 * The rider *identity* is never taken from here - it is always looked up
 * from the authenticated user's own riders row below.
 */
export interface DayTotals {
  completed: number;
  /** Closed as failed (the rider's "can't deliver", or staff marked it failed). */
  failed: number;
  /** Closed because the customer could not be reached (staff: customer unavailable). */
  customer_unavailable: number;
  /** COD cash taken at the door (deliveries.cod_collected_amount), LKR. */
  cash_collected: number;
}

export interface RiderDayDelivery {
  delivery_id: string;
  order_number: string;
  outcome: 'DELIVERED' | 'FAILED' | 'CUSTOMER_UNAVAILABLE';
  /** Delivered or failed at. */
  at: string;
  cash_collected: number;
}

export interface RiderDay {
  timezone: 'Asia/Colombo';
  today: DayTotals & { date: string };
  week: DayTotals & { starts_on: string };
  /** Newest first. */
  deliveries_today: RiderDayDelivery[];
}

export class RiderService {
  private async getRiderOrThrow(userId: string) {
    const rider = await riderRepository.findRiderByUserId(userId);
    if (!rider) {
      throw new AppError('Rider profile not found for this user account.', 403, 'RIDER_PROFILE_NOT_FOUND');
    }
    // Rider applications (migration 029): not before approval.
    if (rider.approval_status === 'PENDING') {
      throw new AppError('Your application is waiting for approval.', 403, 'RIDER_PENDING_APPROVAL');
    }
    if (rider.approval_status === 'REJECTED') {
      throw new AppError("Your application wasn't approved.", 403, 'RIDER_APPLICATION_REJECTED', {
        reason: rider.rejection_reason,
      });
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
    actor: Actor,
    newStatus: RiderDeliveryStatus,
    failureReason?: string
  ) {
    const rider = await this.getRiderOrThrow(actor.id);
    await runTransition(RIDER_STEP[newStatus], {
      actor,
      deliveryId,
      riderId: rider.id,
      input: { failure_reason: failureReason },
    });
    return await riderRepository.findDeliveryById(deliveryId, rider.id);
  }

  /**
   * "My day" (Rider app): counts and cash for the calling rider only - today
   * and this week (Monday to Sunday, Asia/Colombo) - plus today's finished
   * deliveries. The rider is resolved from the token, never from the request.
   * No pay amounts: the owner asked for counts only.
   */
  async getMyDay(userId: string): Promise<RiderDay> {
    const rider = await this.getRiderOrThrow(userId);
    const [rows, calendar] = await Promise.all([
      riderRepository.findFinishedThisWeek(rider.id),
      riderRepository.colomboCalendar(),
    ]);
    const empty = (): DayTotals => ({ completed: 0, failed: 0, customer_unavailable: 0, cash_collected: 0 });
    const today = empty();
    const week = empty();
    const deliveriesToday: RiderDayDelivery[] = [];
    for (const row of rows) {
      const outcome: RiderDayDelivery['outcome'] =
        row.assignment_status === 'DELIVERED'
          ? 'DELIVERED'
          : row.closed_as === 'CUSTOMER_UNAVAILABLE'
            ? 'CUSTOMER_UNAVAILABLE'
            : 'FAILED';
      const cash = outcome === 'DELIVERED' ? Number(row.cod_collected_amount) : 0;
      for (const totals of row.is_today ? [today, week] : [week]) {
        if (outcome === 'DELIVERED') totals.completed += 1;
        else if (outcome === 'CUSTOMER_UNAVAILABLE') totals.customer_unavailable += 1;
        else totals.failed += 1;
        totals.cash_collected += cash;
      }
      if (row.is_today) {
        deliveriesToday.push({
          delivery_id: row.delivery_id,
          order_number: row.order_number,
          outcome,
          at: (row.delivered_at ?? row.failed_at)!.toISOString(),
          cash_collected: Number(cash.toFixed(2)),
        });
      }
    }
    today.cash_collected = Number(today.cash_collected.toFixed(2));
    week.cash_collected = Number(week.cash_collected.toFixed(2));
    return {
      timezone: 'Asia/Colombo',
      today: { date: calendar.today, ...today },
      week: { starts_on: calendar.week_starts_on, ...week },
      deliveries_today: deliveriesToday,
    };
  }

  /** Lifecycle #9 RIDER_COLLECT_COD, settled by the shared COD settlement. */
  async collectCod(deliveryId: string, actor: Actor, amount: number, deliveryCode: string) {
    const rider = await this.getRiderOrThrow(actor.id);
    return await runTransition<CodSettlement>('RIDER_COLLECT_COD', {
      actor,
      deliveryId,
      riderId: rider.id,
      input: { amount, delivery_code: deliveryCode },
    });
  }
}

export const riderService = new RiderService();
