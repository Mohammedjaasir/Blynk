import { AppError } from '../../middleware/error.middleware.js';

interface RateLimitRecord {
  timestamps: number[];
}

class InMemoryRateLimiter {
  private records = new Map<string, RateLimitRecord>();

  /**
   * Checks whether the key has exceeded maxRequests within windowMs.
   * If not exceeded, records the current timestamp.
   * If exceeded, throws 429 AppError.
   */
  public checkLimit(key: string, maxRequests: number, windowMs: number, customMessage?: string): void {
    const now = Date.now();
    const cutoff = now - windowMs;

    let record = this.records.get(key);
    if (!record) {
      record = { timestamps: [] };
      this.records.set(key, record);
    }

    // Filter out expired timestamps
    record.timestamps = record.timestamps.filter((t) => t > cutoff);

    if (record.timestamps.length >= maxRequests) {
      const oldest = record.timestamps[0];
      const retryAfterSec = Math.ceil((oldest + windowMs - now) / 1000);
      throw new AppError(
        customMessage || `Too many requests. Please try again in ${retryAfterSec} seconds.`,
        429,
        'TOO_MANY_REQUESTS',
        { retry_after_seconds: retryAfterSec }
      );
    }

    record.timestamps.push(now);
  }

  /**
   * Resets rate limiter memory (useful for testing).
   */
  public reset(): void {
    this.records.clear();
  }
}

export const authRateLimiter = new InMemoryRateLimiter();
