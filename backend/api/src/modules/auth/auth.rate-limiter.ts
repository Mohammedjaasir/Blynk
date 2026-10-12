import { AppError } from '../../middleware/error.middleware.js';

interface RateLimitRecord {
  timestamps: number[];
  /** The longest window this key has been checked with, for the sweep. */
  windowMs: number;
}

export interface RateLimitCheck {
  key: string;
  max: number;
  windowMs: number;
  message?: string;
}

/** Above this many keys, expired keys are swept (at most once a minute). */
export const RATE_LIMIT_SWEEP_THRESHOLD = 10_000;
/** Hard cap: above it a sweep runs at once and, if still over, drops the least recently used keys. */
export const RATE_LIMIT_MAX_KEYS = 50_000;
const SWEEP_INTERVAL_MS = 60 * 1000;

class InMemoryRateLimiter {
  private records = new Map<string, RateLimitRecord>();
  private lastSweep = 0;

  /** Live timestamps of `key` inside `windowMs`; a key with none left is deleted. */
  private live(key: string, windowMs: number, now: number): number[] {
    const record = this.records.get(key);
    if (!record) return [];
    const cutoff = now - windowMs;
    const timestamps = record.timestamps.filter((t) => t > cutoff);
    if (timestamps.length === 0) {
      this.records.delete(key);
      return [];
    }
    record.timestamps = timestamps;
    return timestamps;
  }

  private refused(check: RateLimitCheck, oldest: number, now: number): AppError {
    const retryAfterSec = Math.ceil((oldest + check.windowMs - now) / 1000);
    return new AppError(
      check.message || `Too many requests. Please try again in ${retryAfterSec} seconds.`,
      429,
      'TOO_MANY_REQUESTS',
      { retry_after_seconds: retryAfterSec }
    );
  }

  private record(key: string, windowMs: number, now: number): void {
    const record = this.records.get(key);
    if (record) {
      record.timestamps.push(now);
      record.windowMs = Math.max(record.windowMs, windowMs);
      // Re-inserted so Map order stays "least recently used first" for the cap.
      this.records.delete(key);
      this.records.set(key, record);
    } else {
      this.records.set(key, { timestamps: [now], windowMs });
    }
    const size = this.records.size;
    if (size > RATE_LIMIT_MAX_KEYS || (size > RATE_LIMIT_SWEEP_THRESHOLD && now - this.lastSweep >= SWEEP_INTERVAL_MS)) {
      this.sweep(now);
    }
  }

  /** Drops every key whose window is empty, then the least recently used keys above the cap. */
  private sweep(now: number): void {
    this.lastSweep = now;
    for (const [key, record] of this.records) this.live(key, record.windowMs, now);
    for (const key of this.records.keys()) {
      if (this.records.size <= RATE_LIMIT_MAX_KEYS) break;
      this.records.delete(key);
    }
  }

  /**
   * Checks whether the key has exceeded maxRequests within windowMs.
   * If not exceeded, records the current timestamp.
   * If exceeded, throws 429 AppError.
   *
   * A request guarded by more than one key uses checkLimits() instead, so a
   * refusal by one key never uses up the quota of another.
   */
  public checkLimit(key: string, maxRequests: number, windowMs: number, customMessage?: string): void {
    this.checkLimits([{ key, max: maxRequests, windowMs, message: customMessage }]);
  }

  /**
   * Checks every limit first, recording nothing, and records all keys only
   * when every limit passes. (Security audit 2026-10: an OTP request refused
   * by the per-IP limit used to burn a slot of the phone's hourly quota, so
   * anyone could block SMS sign-in for any number.) Limits are checked in
   * order; the first one exceeded is the one reported.
   */
  public checkLimits(checks: RateLimitCheck[]): void {
    const now = Date.now();
    for (const check of checks) {
      const timestamps = this.live(check.key, check.windowMs, now);
      if (timestamps.length >= check.max) throw this.refused(check, timestamps[0], now);
    }
    for (const check of checks) this.record(check.key, check.windowMs, now);
  }

  /** Number of keys held (tests). */
  public size(): number {
    return this.records.size;
  }

  /** Keys held (tests). */
  public keys(): string[] {
    return [...this.records.keys()];
  }

  /** Whether a key is held (tests). */
  public has(key: string): boolean {
    return this.records.has(key);
  }

  /** Forgets one key (tests: simulates a request from a fresh IP). */
  public clear(key: string): void {
    this.records.delete(key);
  }

  /**
   * Resets rate limiter memory (useful for testing).
   */
  public reset(): void {
    this.records.clear();
    this.lastSweep = 0;
  }
}

export const authRateLimiter = new InMemoryRateLimiter();
