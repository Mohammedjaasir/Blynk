import { apiGet, apiPost } from '@/blynk/api/client';
import { authed, getSession } from '@/blynk/auth/session';
import { noteNotReady } from '@/blynk/lib/featureGate';
import { parseMyRequests, type MyRequest, type RequestBody } from './model';

/*
 * Product requests (migration 056). A guest sends without a token (the server limits by IP); a
 * signed-in customer's request is theirs (and shows in My requests). A 503
 * PRODUCT_REQUESTS_NOT_READY hides the feature until the next start.
 */

/** POST /product-requests -> 201. */
export async function sendProductRequest(body: RequestBody): Promise<void> {
  try {
    if (getSession()) await authed((t) => apiPost<unknown>('/product-requests', body, t));
    else await apiPost<unknown>('/product-requests', body);
  } catch (e) {
    noteNotReady(e, 'requests');
    throw e;
  }
}

/** GET /me/product-requests: this customer's requests, newest first. */
export async function fetchMyRequests(signal?: AbortSignal): Promise<MyRequest[]> {
  try {
    return parseMyRequests(await authed((t) => apiGet<unknown>('/me/product-requests', t, signal)));
  } catch (e) {
    noteNotReady(e, 'requests');
    throw e;
  }
}
