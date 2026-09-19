/**
 * The one HTTP client for the Inventory app. Every call goes through here so
 * token handling, error shaping and the base URL live in one place.
 *
 * Same architecture as the Admin app's client (one apiRequest, a token store,
 * single-flight refresh), kept separate on purpose: Inventory is its own
 * application with its own session, so it stores tokens under its own keys
 * and signing out of one app never signs you out of the other.
 *
 * Authorization is never decided here: the browser only carries the token.
 * The backend enforces requireAuth + requireRoles on every inventory route.
 */
const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:4000/api/v1';

const ACCESS_TOKEN_KEY = 'blynk.inventory.accessToken';
const REFRESH_TOKEN_KEY = 'blynk.inventory.refreshToken';

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
export type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: Json;
  query?: Query;
  auth?: boolean;
}

/** Listeners told when the session is gone for good (refresh refused). */
const sessionEndedListeners = new Set<() => void>();
export function onSessionEnded(listener: () => void): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

function buildUrl(path: string, query?: Query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return `${BASE_URL}${path}${qs ? `?${qs}` : ''}`;
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
  if (response.status === 401 && auth) {
    tokenStore.clear();
    sessionEndedListeners.forEach((listener) => listener());
  }

  const text = await response.text();
  let payload: Json = {};
  try {
    payload = text ? (JSON.parse(text) as Json) : {};
  } catch {
    // A non-JSON body (proxy error page) is still an error to report cleanly.
  }

  if (!response.ok) {
    const error = (payload.error ?? {}) as { message?: string; code?: string; details?: unknown };
    throw new ApiError(error.message ?? 'Request failed.', response.status, error.code, error.details);
  }

  return (payload.data ?? payload) as T;
}

async function send(path: string, { method = 'GET', body, query }: RequestOptions, auth: boolean) {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = tokenStore.access;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network-level failure: never surface the raw exception to an operator.
    throw new ApiError('Could not reach the Blynk API. Check the connection and try again.', 0, 'NETWORK');
  }
}

let refreshing: Promise<boolean> | null = null;

/**
 * One refresh at a time. The backend rotates refresh tokens and treats a
 * reused one as a replay (revoking every session), so the several requests a
 * page fires at once must share a single refresh rather than race.
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
