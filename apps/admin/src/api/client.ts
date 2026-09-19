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
  if (response.status === 401 && auth && tokenStore.refresh) {
    if (await refreshSession()) response = await send(path, options, auth);
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

let refreshing: Promise<boolean> | null = null;

/**
 * One refresh at a time. The backend rotates refresh tokens and treats a
 * reused one as a replay (revoking every session), so the several requests
 * a page fires at once must share a single refresh rather than race.
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
