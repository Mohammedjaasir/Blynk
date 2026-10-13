import { useSyncExternalStore } from 'react';
import { apiGet, apiPost, ApiError } from '@/blynk/api/client';
import { storage } from '@/blynk/lib/storage';

/*
 * The signed-in customer: tokens and user, persisted to localStorage on the web (an in-memory
 * fallback elsewhere) and restored on load. A tiny external store, read with useSession().
 * Every signed-in call goes through authed(): on a 401 it refreshes once (the refresh token is
 * single-use, so the rotated pair is stored), retries, and ends the session when the server
 * refuses the refresh (401/403, as Flutter's AuthProvider.refreshToken). Being offline, a
 * timeout or a server error keeps the customer signed in.
 *
 * However a session ends (logout, a refused refresh, account deletion) the end handlers run once
 * with the session that ended and why (onSessionEnd): they clear this customer's local state
 * and unregister the push device with the old access token (src/blynk/account/cleanup.ts).
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

/** Why a session ended: the customer logged out, the server refused it, or the account was deleted. */
export type SessionEndReason = 'logout' | 'rejected' | 'deleted';
type EndHandler = (ended: Session, reason: SessionEndReason) => void;
const endHandlers = new Set<EndHandler>();

/** Run `fn` whenever a session ends (after the session is cleared). Returns an unsubscribe. */
export function onSessionEnd(fn: EndHandler): () => void {
  endHandlers.add(fn);
  return () => { endHandlers.delete(fn); };
}

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

/** Clear the session here (local first) and tell the end handlers. A no-op when signed out. */
export function endSession(reason: SessionEndReason): Session | null {
  const s = current;
  if (!s) return null;
  set(null);
  endHandlers.forEach((h) => {
    try { h(s, reason); } catch { /* a cleanup step never blocks the sign-out */ }
  });
  return s;
}

/** Log out: signed out here at once; the refresh token is revoked best-effort on the server. */
export function signOut() {
  const s = endSession('logout');
  if (s) void apiPost('/auth/logout', { refresh_token: s.refreshToken }).catch(() => undefined);
}

/** A refusal of the refresh token that means this login is over (Flutter: 401 or 403). */
export const isSessionRefusal = (e: unknown) => e instanceof ApiError && (e.status === 401 || e.status === 403);

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
      // refused (expired, revoked, account deactivated, staff disabled): the login is over. Being
      // offline, a timeout or a server error keeps the session so the next try can refresh.
      if (isSessionRefusal(e)) {
        if (current === s) endSession('rejected');
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

/**
 * Background check of a restored session (Flutter's _revalidate): GET /auth/me refreshes the
 * stored user (name, email, role). A refused refresh ends the session through authed(); being
 * offline changes nothing. Never throws.
 */
export async function revalidateSession(): Promise<void> {
  const s = current;
  if (!s) return;
  try {
    const me = await authed((t) => apiGet<Partial<SessionUser> | null>('/auth/me', t));
    if (!me || !current || current.user.id !== s.user.id || me.id !== s.user.id) return;
    const patch: Partial<SessionUser> = {};
    if (typeof me.phone === 'string' && me.phone) patch.phone = me.phone;
    if (typeof me.role === 'string' && me.role) patch.role = me.role;
    if ('full_name' in me) patch.full_name = me.full_name ?? null;
    if ('email' in me) patch.email = me.email ?? null;
    updateUser(patch);
  } catch { /* offline or a server error: keep what is stored */ }
}

/**
 * A fresh access token for a raw request (the location stream) that got a 401 with `stale`:
 * the current one if another call already refreshed, else one refresh. Null when the session
 * is over (the refusal has already ended it).
 */
export async function freshAccessToken(stale: string): Promise<string | null> {
  const s = current;
  if (!s) return null;
  if (s.accessToken !== stale) return s.accessToken;
  const next = await refresh();
  return next?.accessToken ?? null;
}
