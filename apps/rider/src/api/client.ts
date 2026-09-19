/**
 * The one HTTP client for the Rider app. Every call goes through here so
 * token handling, error shaping, timeouts and the base URL live in one place.
 *
 * Same architecture as the Admin and Inventory clients (one apiRequest, a
 * token store, single-flight refresh), kept separate on purpose: Rider is its
 * own application with its own session and storage keys.
 *
 * Authorization is never decided here: the browser only carries the token.
 * The backend enforces requireAuth + requireRoles('RIDER') and checks that
 * the delivery belongs to this rider on every call.
 */
const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:4000/api/v1';

const ACCESS_TOKEN_KEY = 'blynk.rider.accessToken';
const REFRESH_TOKEN_KEY = 'blynk.rider.refreshToken';

/** A rider on a weak connection should hear back, not wait forever. */
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get access(): string | null {
    try {
      return localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  get refresh(): string | null {
    try {
      return localStorage.getItem(REFRESH_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  save(access: string, refresh?: string | null) {
    try {
      localStorage.setItem(ACCESS_TOKEN_KEY, access);
      if (refresh) localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
    } catch {
      /* storage unavailable - the session simply won't survive a reload */
    }
  },
  clear() {
    try {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
    } catch {
      /* ignored */
    }
  },
};

type Json = Record<string, unknown>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: Json;
  auth?: boolean;
}

/**
 * Why a session ended: the refresh token was refused ('expired'), or the API
 * says this account has no usable rider profile ('profile').
 */
export type SessionEndReason = 'expired' | 'profile';

/** Codes that mean the account can't work as a rider, whatever it asked for. */
const PROFILE_REFUSED = new Set(['RIDER_PROFILE_NOT_FOUND', 'RIDER_INACTIVE']);

const sessionEndedListeners = new Set<(reason: SessionEndReason) => void>();
export function onSessionEnded(listener: (reason: SessionEndReason) => void): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}
function endSession(reason: SessionEndReason) {
  tokenStore.clear();
  sessionEndedListeners.forEach((listener) => listener(reason));
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const auth = options.auth ?? true;
  let response = await send(path, options, auth);

  // Access tokens last 15 minutes. On a 401, trade the refresh token for a
  // new pair once and retry - the backend still decides what that session
  // may do.
  if (response.status === 401 && auth && tokenStore.refresh) {
    if (await refreshSession()) response = await send(path, options, auth);
  }
  if (response.status === 401 && auth) endSession('expired');

  const text = await response.text();
  let payload: Json = {};
  try {
    payload = text ? (JSON.parse(text) as Json) : {};
  } catch {
    // A non-JSON body (proxy error page) is still an error to report cleanly.
  }

  if (!response.ok) {
    const error = (payload.error ?? {}) as { message?: string; code?: string; details?: unknown };
    if (response.status === 403 && error.code && PROFILE_REFUSED.has(error.code)) endSession('profile');
    throw new ApiError(error.message ?? 'Request failed.', response.status, error.code, error.details);
  }

  return (payload.data ?? payload) as T;
}

async function send(path: string, { method = 'GET', body }: RequestOptions, auth: boolean) {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = tokenStore.access;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // A timeout is not the same as "nothing was sent": the server may have
    // applied the change. Callers re-read the delivery before retrying.
    if ((err as Error)?.name === 'AbortError') {
      throw new ApiError('The Blynk API did not answer in time.', 0, 'TIMEOUT');
    }
    throw new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * One refresh at a time. The backend rotates refresh tokens and treats a
 * reused one as a replay (revoking every session), so concurrent requests
 * must share a single refresh rather than race.
 */
function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: tokenStore.refresh }),
      });
      if (!response.ok) throw new Error('refresh rejected');
      const payload = JSON.parse(await response.text()) as {
        data: { access_token: string; refresh_token: string };
      };
      tokenStore.save(payload.data.access_token, payload.data.refresh_token);
      return true;
    } catch {
      tokenStore.clear();
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}
