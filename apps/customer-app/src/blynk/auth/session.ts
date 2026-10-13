import { useSyncExternalStore } from 'react';
import { apiPost, ApiError } from '@/blynk/api/client';
import { storage } from '@/blynk/lib/storage';

/*
 * The signed-in customer: tokens and user, persisted to localStorage on the web (an in-memory
 * fallback elsewhere) and restored on load. A tiny external store, read with useSession().
 * Every signed-in call goes through authed(): on a 401 it refreshes once (the refresh token is
 * single-use, so the rotated pair is stored), retries, and clears the session when the
 * refresh is refused.
 */
export const SESSION_KEY = 'blynk.app.session.v1';

export type SessionUser = {
  id: string;
  phone: string;
  role: string;
  full_name: string | null;
  email: string | null;
};

export type Session = { accessToken: string; refreshToken: string; user: SessionUser };

/** POST /auth/otp/verify data. */
export type VerifyResult = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  expires_in?: number;
  user: SessionUser;
};

type TokenPair = { access_token: string; refresh_token: string };

function valid(s: unknown): s is Session {
  const v = s as Session | null;
  return !!v && typeof v.accessToken === 'string' && typeof v.refreshToken === 'string'
    && !!v.user && typeof v.user.id === 'string' && typeof v.user.phone === 'string';
}

function restore(): Session | null {
  try {
    const raw = storage.get(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let current: Session | null = restore();
const listeners = new Set<() => void>();

function set(next: Session | null) {
  current = next;
  // signing out clears the stored copy; the adapter never throws
  storage.set(SESSION_KEY, next ? JSON.stringify(next) : '');
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};

export const getSession = () => current;

export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, getSession);
}

/** Signed in, but the account has no name yet: the first verify created it. */
export function needsRegistration(s: Session | null = current): boolean {
  return !!s && !(s.user.full_name ?? '').trim();
}

/** Store the verify result. Returns the new session. */
export function signIn(result: VerifyResult): Session {
  const s: Session = { accessToken: result.access_token, refreshToken: result.refresh_token, user: { ...result.user } };
  set(s);
  return s;
}

/** Merge profile changes (PATCH /me) into the stored user. */
export function updateUser(patch: Partial<SessionUser>) {
  if (current) set({ ...current, user: { ...current.user, ...patch } });
}

/** Forget the session here; the refresh token is revoked best-effort on the server. */
export function signOut() {
  const s = current;
  set(null);
  if (s) void apiPost('/auth/logout', { refresh_token: s.refreshToken }).catch(() => undefined);
}

// one refresh at a time: concurrent 401s share it (the old refresh token is single-use)
let refreshing: Promise<Session | null> | null = null;

function refresh(): Promise<Session | null> {
  if (refreshing) return refreshing;
  const s = current;
  if (!s) return Promise.resolve(null);
  refreshing = apiPost<TokenPair>('/auth/refresh', { refresh_token: s.refreshToken })
    .then((pair) => {
      // a sign-out or a new sign-in meanwhile wins
      if (current !== s) return current;
      const next = { ...s, accessToken: pair.access_token, refreshToken: pair.refresh_token };
      set(next);
      return next;
    })
    .catch((e) => {
      // refused (expired, revoked, account deactivated): sign out. A network failure keeps the
      // session so the next try can refresh.
      if (!(e instanceof ApiError) || (e.status > 0 && e.status !== 408)) {
        if (current === s) set(null);
        return null;
      }
      throw e;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

const signInAgain = () => new ApiError('Please sign in again.', 401, 'UNAUTHENTICATED');

/** Run a signed-in request with the current access token; refresh once on a 401 and retry. */
export async function authed<T>(request: (accessToken: string) => Promise<T>): Promise<T> {
  const s = current;
  if (!s) throw signInAgain();
  try {
    return await request(s.accessToken);
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 401) throw e;
  }
  // another call may have refreshed meanwhile: use its pair rather than spend the new refresh token
  const next = current && current !== s && current.user.id === s.user.id ? current : await refresh();
  if (!next) throw signInAgain();
  return request(next.accessToken);
}
