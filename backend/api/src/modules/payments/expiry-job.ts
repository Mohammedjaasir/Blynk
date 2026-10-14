import { logger } from '../../utils/logger.js';
import { payhereService } from './payhere.service.js';

/**
 * Worker tick (migration 047): every minute, cancels unpaid online orders
 * whose payment window has passed (lifecycle PAYMENT_EXPIRED). Safe to run
 * alongside the API: each expiry re-checks under the order lock.
 */
export const PAYMENT_EXPIRY_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = payhereService
    .expireStalePayments()
    .catch((err) => {
      // Before migration 047 is applied the column does not exist yet.
      if ((err as { code?: string }).code === '42703' || (err as { code?: string }).code === '22P02') return;
      logger.error({ err }, 'Payment expiry sweep failed');
    })
    .finally(() => {
      running = null;
    });
  await running;
}

export const paymentExpiryJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), PAYMENT_EXPIRY_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
