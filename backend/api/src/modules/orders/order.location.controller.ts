import { Request, Response, NextFunction } from 'express';
import { orderRepository } from './order.repository.js';
import { orderItemParamsSchema } from './order.schema.js';
import { subscribe, writeLocationEvent, writeClosedEvent, type LocationEvent } from '../realtime/location-stream.js';
import { AppError } from '../../middleware/error.middleware.js';
import { metrics } from '../../utils/metrics.js';
import { logger } from '../../utils/logger.js';

/** How often an open stream re-checks whether its order is still trackable
 * (plan §7): the stream closes within one interval of the actual state
 * change, not instantly - a documented, bounded latency, not a defect. */
const HEARTBEAT_MS = 15_000;

function toEvent(row: {
  current_latitude: unknown;
  current_longitude: unknown;
  location_accuracy_m: unknown;
  location_captured_at: Date | null;
  location_received_at: Date | null;
}): LocationEvent | null {
  if (row.current_latitude == null || row.location_captured_at == null || row.location_received_at == null) return null;
  return {
    latitude: Number(row.current_latitude),
    longitude: Number(row.current_longitude),
    accuracy: row.location_accuracy_m == null ? null : Number(row.location_accuracy_m),
    captured_at: row.location_captured_at.toISOString(),
    received_at: row.location_received_at.toISOString(),
  };
}

/**
 * GET /orders/:id/location/stream - the customer's own live rider location,
 * and nothing else's (plan §9). Ownership is checked once at connect (404
 * for both "no such order" and "not yours" - anti-enumeration, matching
 * every other customer-facing order endpoint) and the trackable window is
 * re-checked, along with ownership, on every heartbeat.
 *
 * Deliberately never imports modules/orders/lifecycle/* (plan §D.5): this
 * is a read-only stream over the same five latest-location columns Task B2
 * writes, and it never changes order_status or assignment_status.
 */
export async function streamOrderLocation(req: Request, res: Response, next: NextFunction) {
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let heartbeat: NodeJS.Timeout | null = null;

  const cleanup = () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const end = (reason: 'not_trackable' | 'delivery_closed') => {
    if (closed) return;
    cleanup();
    writeClosedEvent(res, reason);
    res.end();
    metrics.streamsClosed(reason);
  };

  // Registered before the first await: a client that leaves while a query is
  // in flight must not be subscribed (and left subscribed) afterwards.
  req.on('close', cleanup);

  try {
    const { id: orderId } = orderItemParamsSchema.parse(req.params);

    // Ownership check (404 for not-found AND not-yours - never 403, so a
    // customer probing order IDs can't distinguish "doesn't exist" from
    // "someone else's").
    const order = await orderRepository.findOrderById(orderId, req.user!.id);
    if (!order) {
      throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    }

    // Every query that can fail with the response still untouched runs before
    // the SSE headers go out, so a database error is an ordinary JSON 500 from
    // the error middleware - never a second set of headers on a live stream.
    const row = await orderRepository.findTrackableLocationForCustomer(orderId, req.user!.id);
    if (closed) return; // the client left during the query: nothing to write to

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    if (!row) {
      end('not_trackable');
      return;
    }
    const initial = toEvent(row);
    if (initial) writeLocationEvent(res, initial);
    unsubscribe = subscribe(orderId, res);
    metrics.streamsOpened();

    heartbeat = setInterval(async () => {
      if (closed) return;
      try {
        const stillTrackable = await orderRepository.findTrackableLocationForCustomer(orderId, req.user!.id);
        // Re-check after the await: the client can disconnect (req.on('close')
        // sets closed=true, clears this interval, unsubscribes) while this
        // query is in flight. Without this second check, a tick that was
        // already running when the disconnect happened would fall through
        // and write to (or end()) a response whose socket is already gone.
        if (closed) return;
        if (!stillTrackable) {
          end('delivery_closed');
          return;
        }
        res.write(': heartbeat\n\n');
      } catch (err) {
        // Best-effort: a transient DB error on a heartbeat re-check should
        // not tear down an otherwise-healthy stream; the next tick retries.
        logger.warn({ err, orderId }, 'Location stream heartbeat re-check failed; will retry next tick');
      }
    }, HEARTBEAT_MS);
  } catch (err) {
    cleanup();
    if (res.headersSent) {
      // Failed after the stream began (e.g. the socket died mid-write): there
      // is no JSON error to send on an event stream - just end it, once.
      logger.warn({ err }, 'Location stream failed after headers were sent; ending the response');
      if (!res.writableEnded) res.end();
      return;
    }
    next(err);
  }
}
