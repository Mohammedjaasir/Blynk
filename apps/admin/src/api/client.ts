/**
 * The one HTTP client for the admin app. Every call goes through here so
 * token handling, error shaping and the base URL live in a single place -
 * mirroring how the customer app has exactly one ApiService.
 *
 * Authorization is never decided here: the browser only carries the token.
 * The backend enforces requireAuth + requireRoles('ADMIN') on every admin
 * route, so hiding a button in this app is convenience, not security.
 */
const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:4000/api/v1';

const ACCESS_TOKEN_KEY = 'blynk.admin.accessToken';
const REFRESH_TOKEN_KEY = 'blynk.admin.refreshToken';

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
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: Json | FormData;
  auth?: boolean;
  signal?: AbortSignal;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const auth = options.auth ?? true;
  let response = await send(path, options, auth);

  // Access tokens last 15 minutes. On a 401, trade the refresh token for a
  // new pair once and retry - the backend still decides whether the
  // refreshed session is allowed to do this.
  if (response.status === 401 && auth) {
    const outcome = tokenStore.refresh ? await refreshSession() : 'refused';
    if (outcome === 'ok') {
      response = await send(path, options, auth);
    } else if (outcome === 'refused') {
      // The server said no: the session is over. Signed-in screens must not
      // keep erroring, so the app goes back to sign-in (AuthContext).
      tokenStore.clear();
      notifySessionEnded();
    } else {
      // No answer (offline, timeout, 5xx): the session may still be good, so
      // nothing is signed out - the request fails like any network failure.
      throw new ApiError(
        outcome === 'unreachable' ? 'Could not reach the Blynk API.' : 'Could not renew your session right now. Try again in a moment.',
        outcome === 'unreachable' ? 0 : 503,
        outcome === 'unreachable' ? 'NETWORK' : 'REFRESH_UNAVAILABLE'
      );
    }
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as Json) : {};

  if (!response.ok) {
    const error = (payload.error ?? {}) as { message?: string; code?: string; details?: unknown };
    throw new ApiError(
      error.message ?? 'Request failed.',
      response.status,
      error.code,
      error.details
    );
  }

  return (payload.data ?? payload) as T;
}

async function send(
  path: string,
  { method = 'GET', body, signal }: RequestOptions,
  auth: boolean
): Promise<Response> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;

  if (body && !isForm) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = tokenStore.access;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  try {
    return await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
      signal,
    });
  } catch {
    // Network-level failure: never surface the raw exception to an operator.
    throw new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
  }
}

/**
 * How a refresh ended. Only `refused` (a 4xx from /auth/refresh: revoked,
 * expired, replayed) ends the session; `unreachable` (no response, timeout)
 * and `unavailable` (5xx) leave the tokens alone.
 */
export type RefreshOutcome = 'ok' | 'refused' | 'unreachable' | 'unavailable';

/** A refresh that hangs this long counts as unreachable, never as refused. */
export const REFRESH_TIMEOUT_MS = 15_000;

let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * One refresh at a time. The backend rotates refresh tokens and treats a
 * reused one as a replay (revoking every session), so the several requests
 * a page fires at once must share a single refresh rather than race.
 */
function refreshSession(): Promise<RefreshOutcome> {
  refreshing ??= (async (): Promise<RefreshOutcome> => {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS) : null;
    try {
      let response: Response;
      try {
        response = await fetch(`${BASE_URL}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: tokenStore.refresh }),
          signal: controller?.signal,
        });
      } catch {
        return 'unreachable';
      }
      if (response.status >= 500) return 'unavailable';
      if (!response.ok) {
        tokenStore.clear();
        return 'refused';
      }
      try {
        const payload = JSON.parse(await response.text()) as {
          data: { access_token: string; refresh_token: string };
        };
        tokenStore.save(payload.data.access_token, payload.data.refresh_token);
        return 'ok';
      } catch {
        // A 2xx we cannot read: the server did not refuse, so keep the session.
        return 'unavailable';
      }
    } finally {
      if (timer) clearTimeout(timer);
      refreshing = null;
    }
  })();
  return refreshing;
}

// ------------------------------------------------------- session ended
type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

/** Called when the server refuses the session (refresh rejected). Returns an unsubscribe. */
export function onSessionEnded(listener: SessionListener): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function notifySessionEnded() {
  for (const listener of [...sessionListeners]) listener();
}

/** Multipart upload; the browser sets the boundary, so no Content-Type here. */
export async function uploadImage(
  file: File,
  folder: 'products' | 'promotions'
): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.append('folder', folder);
  form.append('file', file);
  const data = await apiRequest<{ media: { key: string; url: string } }>(
    '/admin/media',
    { method: 'POST', body: form }
  );
  return data.media;
}

export async function deleteImage(url: string): Promise<void> {
  await apiRequest('/admin/media', { method: 'DELETE', body: { url } });
}

// ------------------------------------------------------- private files
/** A private file (rider document page) that hangs this long fails as a timeout. */
export const PRIVATE_FILE_TIMEOUT_MS = 30_000;

/**
 * Rider documents (owner, 2026-10-10): a private file the API serves only
 * with the staff token - there is no public URL. Same base URL, Authorization
 * header and refresh-on-401 as apiRequest, plus a timeout. The caller turns
 * the Blob into an object URL and revokes it when done; nothing is cached or
 * stored (the API also sends Cache-Control: no-store).
 */
export async function fetchPrivateFile(path: string, signal?: AbortSignal): Promise<Blob> {
  let response = await sendForFile(path, signal);

  if (response.status === 401) {
    const outcome = tokenStore.refresh ? await refreshSession() : 'refused';
    if (outcome === 'ok') {
      response = await sendForFile(path, signal);
    } else if (outcome === 'refused') {
      tokenStore.clear();
      notifySessionEnded();
    } else {
      throw new ApiError(
        outcome === 'unreachable' ? 'Could not reach the Blynk API.' : 'Could not renew your session right now. Try again in a moment.',
        outcome === 'unreachable' ? 0 : 503,
        outcome === 'unreachable' ? 'NETWORK' : 'REFRESH_UNAVAILABLE'
      );
    }
  }

  if (!response.ok) {
    let error: { message?: string; code?: string; details?: unknown } = {};
    try {
      const text = await response.text();
      error = ((text ? (JSON.parse(text) as Json) : {}).error ?? {}) as typeof error;
    } catch {
      /* not JSON - keep the generic message */
    }
    throw new ApiError(error.message ?? 'Could not load the file.', response.status, error.code, error.details);
  }

  return response.blob();
}

async function sendForFile(path: string, signal?: AbortSignal): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = tokenStore.access;
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let timedOut = false;
  const timer = controller
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, PRIVATE_FILE_TIMEOUT_MS)
    : null;
  const forward = () => controller?.abort();
  signal?.addEventListener('abort', forward);
  try {
    return await fetch(`${BASE_URL}${path}`, { method: 'GET', headers, cache: 'no-store', signal: controller?.signal });
  } catch {
    if (signal?.aborted) throw new ApiError('Cancelled.', 0, 'ABORTED');
    throw timedOut
      ? new ApiError('The file took too long to load. Try again.', 0, 'TIMEOUT')
      : new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}
