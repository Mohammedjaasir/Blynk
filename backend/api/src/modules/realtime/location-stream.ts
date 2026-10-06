import type { Response } from 'express';

export interface LocationEvent {
  latitude: number;
  longitude: number;
  /** Meters; null when the device reported no estimate (0 or missing). */
  accuracy: number | null;
  captured_at: string;
  received_at: string;
}

/**
 * order_id -> the open SSE responses currently subscribed to it. In-process
 * only (plan §7): correct today because the api service runs as a single
 * container (confirmed via docker-compose.yml). Documented requirement: this
 * must move to a shared broker (Redis pub/sub, or Postgres LISTEN/NOTIFY)
 * before the api service is ever scaled to more than one replica.
 */
const subscribers = new Map<string, Set<Response>>();

function writeEvent(res: Response, event: 'location' | 'closed', data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function subscribe(orderId: string, res: Response): () => void {
  let set = subscribers.get(orderId);
  if (!set) {
    set = new Set();
    subscribers.set(orderId, set);
  }
  set.add(res);
  return () => {
    set!.delete(res);
    if (set!.size === 0) subscribers.delete(orderId);
  };
}

export function broadcastLocation(orderId: string, event: LocationEvent): void {
  const set = subscribers.get(orderId);
  if (!set || set.size === 0) return;
  for (const res of set) writeEvent(res, 'location', event);
}

export function writeLocationEvent(res: Response, event: LocationEvent): void {
  writeEvent(res, 'location', event);
}

export function writeClosedEvent(res: Response, reason: 'not_trackable' | 'delivery_closed' | 'server_shutdown'): void {
  writeEvent(res, 'closed', { reason });
}

export function subscriberCount(orderId: string): number {
  return subscribers.get(orderId)?.size ?? 0;
}

/** Called once during graceful shutdown (server.ts) so server.close() never
 * waits on a long-lived SSE connection that would otherwise never end. */
export function closeAllStreams(): void {
  for (const [orderId, set] of subscribers) {
    for (const res of set) {
      try {
        writeClosedEvent(res, 'server_shutdown');
        res.end();
      } catch {
        // Best-effort during shutdown; a socket that's already gone is fine.
      }
    }
    subscribers.delete(orderId);
  }
}
