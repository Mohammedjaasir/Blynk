/**
 * The one HTTP client for the Operations app. Every call goes through here
 * so token handling, error shaping, timeouts and the base URL live in a
 * single place - the same architecture Admin/Inventory/Rider each already
 * use (one apiRequest, a token store, single-flight refresh), kept separate
 * on purpose: Operations is its own application with its own session and
 * storage keys, never importing from or sharing state with any sibling app.
 *
 * Authorization is never decided here: the browser only carries the token.
 * The backend enforces requireAuth + requireRoles on every route Operations
 * calls, and rider-scoped calls are additionally ownership-checked server
 * side against the caller's own linked rider profile - this client cannot
 * and does not make that decision.
 */
export const BASE_URL: string =
  (import.meta.env?.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:4000/api/v1';

const ACCESS_TOKEN_KEY = 'blynk.operations.accessToken';
const REFRESH_TOKEN_KEY = 'blynk.operations.refreshToken';

/** An operator on a weak mobile connection should hear back, not wait forever. */
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
/** Query-param support (Inventory's `buildUrl` pattern) - Operations' later
 * screens (orders board filters, dental appointment filters, inventory
 * lists) all need this, so it lives in the client once rather than being
 * re-built ad hoc in every `resources.ts` wrapper the way Admin's does. */
export type Query = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** A `FormData` body (task F5's `uploadImage`) skips JSON encoding and the
   * `Content-Type` header entirely, exactly like Admin's own client - the
   * browser sets its own multipart boundary. */
  body?: Json | FormData;
  query?: Query;
  auth?: boolean;
  /** Lets a caller cancel a request (e.g. on unmount); combined with the
   * client's own timeout below, whichever fires first wins. */
  signal?: AbortSignal;
}

/**
 * Why the session ended - today, only ever 'expired' (the refresh token was
 * refused). Unlike the Rider app's client, a rider-profile refusal
 * (`RIDER_PROFILE_NOT_FOUND` / `RIDER_INACTIVE`) deliberately does NOT fire
 * this and does NOT clear tokens: for Operations that refusal only means
 * "this ADMIN account has no usable delivery capability right now" - every
 * other admin capability the session already has keeps working. Ending the
 * whole session on a rider-profile refusal would be wrong here (it isn't
 * wrong for the Rider app, where a rider profile is the ONLY thing the app
 * does). See `src/auth/riderProbe.ts` and `AuthContext`'s `riderCapability`
 * for how that distinction is surfaced instead.
 */
export type SessionEndReason = 'expired';

const sessionEndedListeners = new Set<(reason: SessionEndReason) => void>();
export function onSessionEnded(listener: (reason: SessionEndReason) => void): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}
export function endSession(reason: SessionEndReason) {
  tokenStore.clear();
  sessionEndedListeners.forEach((listener) => listener(reason));
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
  // may do. Only a refusal of the refresh token itself ends the session; a
  // refresh that could not reach the server keeps the tokens and surfaces a
  // retryable connection error instead (a weak signal is not a sign-out).
  if (response.status === 401 && auth && tokenStore.refresh) {
    const outcome = await refreshSession();
    if (outcome === 'refreshed') response = await send(path, options, auth);
    else if (outcome !== 'refused') throw connectionError(outcome);
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
    throw new ApiError(error.message ?? 'Request failed.', response.status, error.code, error.details);
  }

  return (payload.data ?? payload) as T;
}

async function send(
  path: string,
  { method = 'GET', body, query, signal }: RequestOptions,
  auth: boolean
): Promise<Response> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body && !isForm) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = tokenStore.access;
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort();
  signal?.addEventListener('abort', onCallerAbort);
  try {
    return await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body ? (isForm ? (body as FormData) : JSON.stringify(body)) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    // A timeout is not the same as "nothing was sent": the server may have
    // applied the change. Callers re-read the resource before retrying.
    if ((err as Error)?.name === 'AbortError') {
      throw new ApiError('The Blynk API did not answer in time.', 0, 'TIMEOUT');
    }
    throw new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onCallerAbort);
  }
}

/**
 * What became of a refresh attempt:
 * - `refreshed`: new tokens saved.
 * - `refused`: the server rejected the refresh token (400/401/403, e.g.
 *   INVALID_REFRESH_TOKEN) - the tokens are cleared; the caller ends the session.
 * - `network` / `timeout`: the server never answered (or answered with a
 *   5xx/429/unreadable body) - the tokens are KEPT, so a weak connection
 *   neither signs the operator out nor stops background tracking; the caller
 *   reports a retryable error.
 */
export type RefreshOutcome = 'refreshed' | 'refused' | 'network' | 'timeout';

/** The ApiError a caller throws when a refresh could not reach the server. */
export function connectionError(outcome: 'network' | 'timeout'): ApiError {
  return outcome === 'timeout'
    ? new ApiError('The Blynk API did not answer in time.', 0, 'TIMEOUT')
    : new ApiError('Could not reach the Blynk API.', 0, 'NETWORK');
}

/** The refresh token itself was refused (as opposed to a server or connection problem). */
function refreshRefused(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

let refreshing: Promise<RefreshOutcome> | null = null;

/**
 * One refresh at a time. The backend rotates refresh tokens and treats a
 * reused one as a replay (revoking every session), so the several requests
 * a page fires at once must share a single refresh rather than race - and
 * that includes the native location poster (api/native-client.ts): whichever
 * transport starts a refresh, every other caller joins that same one.
 *
 * `transport` (native location posts only) sends the refresh over native
 * HTTP so it still works while the WebView is backgrounded; everything else
 * uses fetch. A transport throws (an ApiError NETWORK/TIMEOUT) when it gets
 * no answer at all.
 */
export type RefreshTransport = (url: string, body: string) => Promise<{ status: number; text: string }>;

const fetchRefresh: RefreshTransport = async (url, body) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
    return { status: response.status, text: await response.text() };
  } catch (err) {
    throw connectionError((err as Error)?.name === 'AbortError' ? 'timeout' : 'network');
  } finally {
    clearTimeout(timer);
  }
};

export function refreshSession(transport: RefreshTransport = fetchRefresh): Promise<RefreshOutcome> {
  refreshing ??= (async (): Promise<RefreshOutcome> => {
    try {
      const url = `${BASE_URL}/auth/refresh`;
      const body = JSON.stringify({ refresh_token: tokenStore.refresh });
      let response: { status: number; text: string };
      try {
        response = await transport(url, body);
      } catch (err) {
        return err instanceof ApiError && err.code === 'TIMEOUT' ? 'timeout' : 'network';
      }
      if (refreshRefused(response.status)) {
        tokenStore.clear();
        return 'refused';
      }
      // 5xx / 429 / anything unexpected: the server is having a moment; the
      // refresh token may well still be good, so keep it.
      if (response.status < 200 || response.status >= 300) return 'network';
      try {
        const payload = JSON.parse(response.text) as { data?: { access_token?: string; refresh_token?: string } };
        if (!payload?.data?.access_token) return 'network';
        tokenStore.save(payload.data.access_token, payload.data.refresh_token);
        return 'refreshed';
      } catch {
        return 'network';
      }
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

/**
 * Multipart upload - added by task F5 (Catalog), which is the first task
 * that needs it (F1's own client.ts deliberately left this out, per its
 * report's note). Ported field-for-field from Admin's `client.ts:160-176` -
 * same two folders (`ALLOWED_FOLDERS` on the backend, `media.controller.ts`),
 * same response shape (`{media:{key,url}}`). The browser sets its own
 * multipart boundary, so no `Content-Type` header is set here - `apiRequest`
 * only adds one when `body` is a plain object (see `send()` above), and a
 * `FormData` body is passed through untouched.
 */
/** The folders `POST /admin/media` will write to - the backend keeps the
 * same whitelist and refuses anything else, so this type is a mirror of it,
 * not the authority. */
export type MediaFolder = 'products' | 'promotions' | 'categories';

export async function uploadImage(file: File, folder: MediaFolder): Promise<{ key: string; url: string }> {
  const form = new FormData();
  form.append('folder', folder);
  form.append('file', file);
  const data = await apiRequest<{ media: { key: string; url: string } }>('/admin/media', {
    method: 'POST',
    body: form,
  });
  return data.media;
}

export async function deleteImage(url: string): Promise<void> {
  await apiRequest('/admin/media', { method: 'DELETE', body: { url } });
}

/**
 * After a SUCCESSFUL save only: removes the stored files the record no
 * longer uses (see lib/image.ts `replacedImages`). Best effort - the record
 * is already saved, and a leftover file is not worth an error.
 */
export async function deleteImagesQuietly(urls: string[]): Promise<void> {
  await Promise.all(
    urls.map((url) =>
      deleteImage(url).catch(() => {
        /* ignored */
      })
    )
  );
}
