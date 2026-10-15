import { logger } from '../../utils/logger.js';
import { expireWallets } from './wallet.service.js';

/**
 * Worker tick (migration 049; owner, 2026-10-15): every hour, writes the
 * EXPIRED rows for Blynk Wallet credits past their date (only credits added
 * while `expiry_months` was above 0 have one). Balances already leave
 * expired credits out before the row is written, so this only keeps the
 * history tidy. Safe alongside the API: each customer is expired under their
 * row lock. Same pattern as the PayHere payment expiry job.
 */
export const WALLET_EXPIRY_INTERVAL_MS = 60 * 60_000;

let timer: NodeJS.Timeout | null = null;
let running: Promise<unknown> | null = null;

async function tick() {
  if (running) return;
  running = expireWallets()
    .catch((err) => {
      // Before migration 049 is applied the table does not exist yet.
      if ((err as { code?: string }).code === '42P01') return;
      logger.error({ err }, 'Wallet expiry sweep failed');
    })
    .finally(() => {
      running = null;
    });
  await running;
}

export const walletExpiryJob = {
  start() {
    if (timer) return;
    timer = setInterval(() => void tick(), WALLET_EXPIRY_INTERVAL_MS);
    void tick();
  },
  async stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (running) await running;
  },
};
