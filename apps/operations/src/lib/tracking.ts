import type { TrackingPermissionState, TrackingPlugin, TrackingPoint } from './geolocation-plugin';

export interface TrackingState {
  permission: TrackingPermissionState;
  active: boolean;
  lastSentAt: Date | null;
  /** 'refused': the server refused the location for good (stopReason says why). */
  lastError: 'permission_denied' | 'position_unavailable' | 'network' | 'refused' | null;
  /** Why sharing was stopped by a server refusal, in the operator's words. */
  stopReason: string | null;
}

/** Time+distance throttle, matching the Rider app's own tuning
 * (apps/rider/src/lib/tracking.ts) - Operations reuses the same numbers
 * since the backend-side rate floor (`MIN_LOCATION_INTERVAL_MS`,
 * rider.location.service.ts) is shared by both apps. */
const MAX_INTERVAL_MS = 9_000;
/** ...unless the device hasn't moved this far, in which case skip until the interval elapses. */
const MIN_DISTANCE_M = 25;

function haversineMeters(a: TrackingPoint, b: TrackingPoint): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Owns the permission state machine and the throttled send loop for one
 * active delivery. Ported unchanged (byte-for-byte logic, common.md rule 2)
 * from apps/rider/src/lib/tracking.ts's own `DeliveryTracker` - that class
 * was already plugin-agnostic (it depends only on the small `TrackingPlugin`
 * interface, never on Capacitor), so nothing here needed to change to swap
 * in `geolocation-plugin.ts`'s plain browser adapter underneath it.
 */
export class DeliveryTracker {
  private state: TrackingState = {
    permission: 'not_requested',
    active: false,
    lastSentAt: null,
    lastError: null,
    stopReason: null,
  };
  private listeners = new Set<(s: TrackingState) => void>();
  private deliveryId: string | null = null;
  private lastSentPoint: TrackingPoint | null = null;
  /** True from the moment stop() begins until plugin.stop() has succeeded: the watcher may still be running. */
  private stopPending = false;

  constructor(
    private plugin: TrackingPlugin,
    private send: (deliveryId: string, point: TrackingPoint) => Promise<void>
  ) {}

  getState(): TrackingState {
    return this.state;
  }

  /** The delivery this tracker is bound to, or null when idle. Set from start() until stop(), even if permission was refused. */
  getDeliveryId(): string | null {
    return this.deliveryId;
  }

  /** A stop failed (or is still in flight): stop() must be attempted again. */
  hasPendingStop(): boolean {
    return this.stopPending;
  }

  subscribe(listener: (s: TrackingState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<TrackingState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  async start(deliveryId: string): Promise<void> {
    // Never run a new watcher beside one whose stop failed.
    if (this.stopPending) await this.stopNative();
    this.deliveryId = deliveryId;
    this.lastSentPoint = null;
    // A new delivery must not briefly show the previous one's freshness or error.
    this.setState({ permission: 'requesting', lastSentAt: null, lastError: null, stopReason: null });
    const permission = await this.plugin.requestPermission();
    this.setState({ permission });
    if (permission !== 'granted') return;

    await this.plugin.start(
      (point) => void this.onPoint(point),
      (code) => this.onError(code)
    );
    this.setState({ active: true, lastError: null });
  }

  async stop(): Promise<void> {
    // Unbind first: a point or a send still in flight for this delivery must
    // never be attributed to (or reported against) whatever is tracked next.
    this.deliveryId = null;
    this.lastSentPoint = null;
    await this.stopNative();
  }

  /** Stops because the server refused this delivery's locations for good, and keeps the reason for the operator. */
  async stopBecause(reason: string): Promise<void> {
    try {
      await this.stop();
    } finally {
      this.setState({ lastError: 'refused', stopReason: reason });
    }
  }

  /**
   * `active` only turns false once the plugin confirms it stopped. If the
   * underlying stop throws, the flag stays up so the next stop()/start()
   * retries instead of forgetting a watcher that may still be running.
   */
  private async stopNative(): Promise<void> {
    this.stopPending = true;
    await this.plugin.stop();
    this.stopPending = false;
    this.setState({ active: false });
  }

  private onError(code: 'permission_denied' | 'position_unavailable'): void {
    // Mid-session revocation: the OS/browser can withdraw location
    // permission while a watch is already running. Reflect that in the
    // permission state too, not just lastError, without tearing down the
    // tracker - the operator is still "in" the delivery and may re-grant.
    if (code === 'permission_denied') {
      this.setState({ lastError: code, permission: 'denied' });
      return;
    }
    this.setState({ lastError: code });
  }

  private async onPoint(point: TrackingPoint): Promise<void> {
    const deliveryId = this.deliveryId;
    if (!deliveryId) return;
    const last = this.lastSentPoint;
    const elapsedMs = last ? point.capturedAt.getTime() - last.capturedAt.getTime() : Infinity;
    const movedEnough = !last || haversineMeters(last, point) >= MIN_DISTANCE_M;
    if (last && elapsedMs < MAX_INTERVAL_MS && !movedEnough) return; // throttled, not sent

    try {
      await this.send(deliveryId, point);
      if (this.deliveryId !== deliveryId) return; // stopped or switched while in flight
      this.lastSentPoint = point;
      this.setState({ lastSentAt: new Date(), lastError: null });
    } catch {
      if (this.deliveryId !== deliveryId) return;
      this.setState({ lastError: 'network' });
    }
  }
}
