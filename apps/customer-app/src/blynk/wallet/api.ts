import { ApiError, apiGet } from '@/blynk/api/client';
import { authed } from '@/blynk/auth/session';
import { parseWallet, type WalletInfo } from './models';

/* Signed-in wallet call (Bearer; authed() refreshes once on a 401). Never called in the design mock. */

export const WALLET_PAGE_SIZE = 30;

/** GET /me/wallet: the balance, the rules and one page of history (newest first). */
export async function fetchWallet(page = 1, limit = WALLET_PAGE_SIZE, signal?: AbortSignal): Promise<WalletInfo> {
  const q = `page=${Math.max(1, Math.trunc(page))}&limit=${Math.max(1, Math.trunc(limit))}`;
  const info = parseWallet(await authed((t) => apiGet<unknown>(`/me/wallet?${q}`, t, signal)));
  if (!info) throw new ApiError('The wallet was not returned by the server.', 500);
  return info;
}
