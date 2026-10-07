import { riderRepository } from './rider.repository.js';
import { AppError } from '../../middleware/error.middleware.js';
import { broadcastLocation } from '../realtime/location-stream.js';
import { metrics } from '../../utils/metrics.js';
import type { UpdateLocationInput } from './rider.location.schema.js';

/** No two accepted writes closer together than this, per delivery (plan §5.3, §D.6). */
export const MIN_LOCATION_INTERVAL_MS = 5_000;
/** Older than this, a point is still accepted and stored but not broadcast live (plan §5.1). */
const STALE_BROADCAST_THRESHOLD_MS = 5 * 60_000;

export type RecordLocationResult =
  | { accepted: true }
  | { accepted: false; reason: 'not_newer' | 'rate_limited' };

/**
 * Records one rider-reported position for one delivery (plan §5). This is
 * deliberately NOT a lifecycle action: it never imports lifecycle/engine.ts,
 * lifecycle/catalogue.ts or lifecycle/actions/* (plan §D.5), and its only
 * database effect is overwriting the five latest-location columns - it can
 * never change order_status or assignment_status.
 */
export class RiderLocationService {
  private async getRiderOrThrow(userId: string) {
    const rider = await riderRepository.findRiderByUserId(userId);
    if (!rider) throw new AppError('Rider profile not found for this user account.', 403, 'RIDER_PROFILE_NOT_FOUND');
    if (rider.approval_status !== 'APPROVED') {
      throw new AppError('This rider has not been approved.', 403, 'RIDER_NOT_APPROVED');
    }
    if (!rider.is_active) throw new AppError('This rider profile is inactive.', 403, 'RIDER_INACTIVE');
    return rider;
  }

  async recordLocation(deliveryId: string, userId: string, input: UpdateLocationInput): Promise<RecordLocationResult> {
    const rider = await this.getRiderOrThrow(userId);

    const delivery = await riderRepository.findTrackableDelivery(deliveryId, rider.id);
    if (!delivery) {
      throw new AppError('Delivery assignment not found.', 404, 'DELIVERY_NOT_FOUND');
    }
    // The trackable window (plan §2.3, §D.1): PICKED_UP and the order still
    // OUT_FOR_DELIVERY, checked fresh against the DB every time - never
    // cached, and independently covers a cancelled order that left this
    // delivery row ASSIGNED (plan §2.2 gotcha #1) because that state is
    // neither PICKED_UP nor OUT_FOR_DELIVERY.
    if (delivery.assignment_status !== 'PICKED_UP' || delivery.order_status !== 'OUT_FOR_DELIVERY') {
      throw new AppError('This delivery is not currently trackable.', 409, 'DELIVERY_NOT_TRACKABLE', {
        assignment_status: delivery.assignment_status,
        order_status: delivery.order_status,
      });
    }

    const nowMs = Date.now();
    // A phone clock running ahead must not lose the point: a capture time in
    // the future is clamped to the server's now (never rejected), so it
    // still orders correctly against later points.
    const capturedAt = new Date(Math.min(new Date(input.captured_at).getTime(), nowMs));

    // Out-of-order or duplicate, fast path: a point no newer than the point
    // this same read just saw stored must never regress the customer's map
    // backward (plan §11). This is only a cheap early exit - it is NOT the
    // authoritative check, because the row can change between this read and
    // the write below (two riders' apps retrying, or one delivery updated
    // from two devices). The write itself re-checks under its own WHERE
    // clause (see writeLocation) and is what actually decides the outcome.
    if (delivery.location_captured_at && capturedAt.getTime() <= delivery.location_captured_at.getTime()) {
      metrics.locationUpdatesRejected('not_newer');
      return { accepted: false, reason: 'not_newer' };
    }

    // Server-side rate floor, independent of the rider app's own throttle
    // (plan §5.3, §D.6) - abuse protection that doesn't trust the client.
    // Soft/best-effort: based on the same read as above, not re-checked
    // atomically by the write. Unlike the not_newer decision, an occasional
    // over-frequent write slipping through under a race is not a
    // correctness problem (plan §D.6 is abuse mitigation, not a data
    // integrity guarantee), so it is left as-is.
    if (delivery.location_received_at && nowMs - delivery.location_received_at.getTime() < MIN_LOCATION_INTERVAL_MS) {
      metrics.locationUpdatesRejected('rate_limited');
      return { accepted: false, reason: 'rate_limited' };
    }

    // The authoritative not_newer check: writeLocation's UPDATE only
    // matches a row whose stored location_captured_at is still NULL or
    // older than this point, evaluated atomically against whatever is
    // currently in the row at the moment Postgres grants this UPDATE the
    // row lock - not against the stale read above. Two concurrent writes to
    // the same delivery are serialized by that per-row lock, so whichever
    // one's UPDATE runs second re-evaluates its WHERE clause against the
    // first one's already-committed result. This closes the TOCTOU gap the
    // fast path above cannot: an older captured_at can never overwrite a
    // newer one, regardless of which request's UPDATE reaches Postgres
    // last.
    const updated = await riderRepository.writeLocation(deliveryId, {
      latitude: input.latitude,
      longitude: input.longitude,
      accuracy: input.accuracy,
      capturedAt,
    });
    if (!updated) {
      metrics.locationUpdatesRejected('not_newer');
      return { accepted: false, reason: 'not_newer' };
    }
    metrics.locationUpdatesReceived();

    const isStale = nowMs - capturedAt.getTime() > STALE_BROADCAST_THRESHOLD_MS;
    const broadcast = (row: NonNullable<typeof updated>) => {
      if (isStale) return;
      broadcastLocation(row.order_id, {
        latitude: Number(row.current_latitude),
        longitude: Number(row.current_longitude),
        accuracy: row.location_accuracy_m == null ? null : Number(row.location_accuracy_m),
        captured_at: row.location_captured_at!.toISOString(),
        received_at: row.location_received_at!.toISOString(),
      });
    };
    broadcast(updated);

    // Rider trips (batching): the device shares one delivery at a time, but
    // the rider is carrying every order they have on the road. The same
    // point goes to this rider's other trackable deliveries (PICKED_UP, order
    // OUT_FOR_DELIVERY - the same window as above), through the same
    // conditional write, so each customer's map follows the rider.
    const siblings = await riderRepository.findOtherTrackableDeliveries(rider.id, deliveryId);
    for (const sibling of siblings) {
      const row = await riderRepository.writeLocation(sibling.id, {
        latitude: input.latitude,
        longitude: input.longitude,
        accuracy: input.accuracy,
        capturedAt,
      });
      if (row) broadcast(row);
    }

    return { accepted: true };
  }
}

export const riderLocationService = new RiderLocationService();
