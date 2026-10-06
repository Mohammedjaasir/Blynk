import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, onSessionEnded, tokenStore } from '../api/client';
import { authApi } from '../api/resources';
import { stopTracking } from '../lib/tracker-session';
import type { AuthUser } from '../api/types';

interface AuthState {
  user: AuthUser | null;
  /**
   * 'offline': a saved session could not be checked (no signal, timeout,
   * server error). The tokens are kept; retry() checks again.
   */
  status: 'loading' | 'authenticated' | 'anonymous' | 'offline';
  retry(): void;
  /** Why the last session ended, shown on the sign-in page. */
  notice: string | null;
  requestOtp(phone: string): Promise<{ devOtp?: string }>;
  verifyOtp(phone: string, otp: string): Promise<void>;
  /** Email + password: the default sign-in; the same rider-only gate as an SMS code. */
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const WRONG_ROLE_MESSAGE = 'This app is for Blynk riders. Sign in with a rider account.';
export const PROFILE_MESSAGE = "Your rider profile isn't active. Contact the store.";
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';

const isRider = (user: AuthUser) => user.role === 'RIDER';

/** The server refused this session (vs. could not be asked). */
const isSessionRefusal = (err: unknown) => err instanceof ApiError && (err.status === 401 || err.status === 403);

/**
 * Sign-in over the existing Blynk OTP flow. Only RIDER accounts get a session
 * here; any other role is signed straight back out. That check is a courtesy:
 * every rider endpoint is guarded by requireRoles('RIDER') and delivery
 * ownership server side, and an account without an active rider profile is
 * refused by the API (RIDER_PROFILE_NOT_FOUND / RIDER_INACTIVE).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  // Bumped by retry() to run the restore again after an offline launch.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!tokenStore.access) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      try {
        const me = await authApi.me();
        if (cancelled) return;
        if (!isRider(me)) {
          tokenStore.clear();
          setNotice(WRONG_ROLE_MESSAGE);
          setStatus('anonymous');
          return;
        }
        setUser(me);
        setStatus('authenticated');
      } catch (err) {
        if (cancelled) return;
        // Only the server refusing the session ends it. The client has
        // already tried a refresh on a 401, so a 401/403 here is final. No
        // signal, a timeout or a server error says nothing about the session:
        // keep the tokens and let the rider retry.
        if (isSessionRefusal(err)) {
          tokenStore.clear();
          setStatus('anonymous');
          return;
        }
        setStatus('offline');
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setStatus('loading');
    setAttempt((n) => n + 1);
  }, []);

  // The client clears the tokens when the session can't continue; reflect
  // that here so the rider returns to sign-in with the reason.
  useEffect(
    () =>
      onSessionEnded((reason) => {
        // Location sharing belongs to this signed-in rider: a session the
        // server ended must not leave the native watcher running (its sends
        // could only be refused from now on).
        stopTracking().catch(() => undefined);
        setUser(null);
        setNotice(reason === 'profile' ? PROFILE_MESSAGE : SESSION_ENDED_MESSAGE);
        setStatus('anonymous');
      }),
    []
  );

  const requestOtp = useCallback(async (phone: string) => {
    const data = await authApi.requestOtp(phone);
    return { devOtp: data.dev_otp };
  }, []);

  // Both sign-in methods end here: the same role gate, the same session.
  const startSession = useCallback((data: { access_token: string; refresh_token: string; user: AuthUser }) => {
    if (!isRider(data.user)) {
      tokenStore.clear();
      throw new ApiError(WRONG_ROLE_MESSAGE, 403, 'FORBIDDEN');
    }
    tokenStore.save(data.access_token, data.refresh_token);
    setNotice(null);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, otp: string) => startSession(await authApi.verifyOtp(phone, otp)),
    [startSession]
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string) => startSession(await authApi.passwordLogin(email, password)),
    [startSession]
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Signing out locally matters more than the server round trip.
    }
    // Location sharing belongs to this signed-in rider: never past sign-out
    // (the native watcher and its notification would otherwise keep running).
    stopTracking().catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    setNotice(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, status, notice, retry, requestOtp, verifyOtp, signInWithPassword, signOut }),
    [user, status, notice, retry, requestOtp, verifyOtp, signInWithPassword, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
