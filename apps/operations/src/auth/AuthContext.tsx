import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, onSessionEnded, tokenStore } from '../api/client';
import { auth as authApi } from '../api/resources';
import type { AuthUser } from '../api/types';
import { probeRiderCapability, type RiderCapability } from './riderProbe';
import { stopTracking } from '../lib/tracker-session';

/**
 * Operations session, built on the existing Blynk OTP authentication - there
 * is no separate Operations auth system and no second identity (common.md
 * rule 3). Only ADMIN accounts get a session here; anyone else is signed
 * straight back out.
 *
 * This role gate is a courtesy to the operator, not a security boundary:
 * the API rejects a non-admin token on every admin route regardless of what
 * this app renders - exactly the same posture Admin's and Rider's own
 * `AuthContext` already document for their own equivalent checks.
 *
 * A second, independent piece of session state - `riderCapability` -
 * answers a different question: does this same ADMIN account *also* have
 * delivery (rider) capability? It is derived, never asserted, by calling
 * the existing `GET /riders/deliveries` endpoint and reading the outcome
 * (see `riderProbe.ts`). It is a UX convenience only, never an
 * authorization decision - every rider-scoped call a later screen makes
 * must still handle a live 403 `RIDER_PROFILE_NOT_FOUND`/`RIDER_INACTIVE`
 * gracefully even if this probe said `ADMIN_PLUS_RIDER` a few minutes ago
 * (the rider profile can be deactivated mid-session). Call
 * `refreshRiderCapability()` to re-probe on demand (e.g. right before
 * entering Delivery Mode) rather than trusting a stale value.
 */
interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  /** Why the last session ended, shown on the sign-in page. */
  notice: string | null;
  /** null until the post-login/restore probe resolves. */
  riderCapability: RiderCapability | null;
  refreshRiderCapability(): Promise<RiderCapability>;
  requestOtp(phone: string): Promise<{ devOtp?: string }>;
  verifyOtp(phone: string, otp: string): Promise<void>;
  /** Staff email + password sign-in - the same role gate as an SMS code. */
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const WRONG_ROLE_MESSAGE =
  'This app is for Blynk operators. Sign in with an Operations or admin account; Inventory staff use the Blynk Inventory site.';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';
/** Opening the app with no signal: the session is kept, not ended. */
export const RESTORE_OFFLINE_MESSAGE =
  "Couldn't reach Blynk to resume your session. You're still signed in - reopen the app when you have signal, or sign in again.";

/**
 * Courtesy check only; the API guards every route by role regardless.
 * ADMIN, plus OPERATIONS (backend migration 014): Operations staff accounts
 * an admin creates in Blynk Admin -> Staff accounts, which open only this
 * app. PACKING_STAFF use the Inventory site and are refused here.
 */
export const OPERATIONS_ROLES: ReadonlyArray<AuthUser['role']> = ['ADMIN', 'OPERATIONS'];
const isOperator = (user: AuthUser) => OPERATIONS_ROLES.includes(user.role);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [riderCapability, setRiderCapability] = useState<RiderCapability | null>(null);

  const refreshRiderCapability = useCallback(async () => {
    const capability = await probeRiderCapability();
    setRiderCapability(capability);
    return capability;
  }, []);

  // Restore an existing session on load, and drop it if the account is not
  // (or is no longer) an Operations account. The rider-capability probe
  // runs as part of the same sequence, so `status` only flips to
  // 'authenticated' once both the identity and the capability are known -
  // simpler for every consumer than a second loading flag.
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
        if (!isOperator(me)) {
          tokenStore.clear();
          setNotice(WRONG_ROLE_MESSAGE);
          setStatus('anonymous');
          return;
        }
        const capability = await probeRiderCapability();
        if (cancelled) return;
        setUser(me);
        setRiderCapability(capability);
        setStatus('authenticated');
      } catch (err) {
        if (cancelled) return;
        // No answer (offline / timeout): keep the tokens so the next launch
        // resumes the session - a weak signal is not a sign-out. Anything
        // else (a refused token, a server error after a refused refresh) drops it.
        if (err instanceof ApiError && (err.code === 'NETWORK' || err.code === 'TIMEOUT')) {
          setNotice(RESTORE_OFFLINE_MESSAGE);
        } else {
          tokenStore.clear();
        }
        setStatus('anonymous');
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // The client clears the tokens only for a genuine session end (refresh
  // refused) - never for a rider-profile refusal, which does not end the
  // ADMIN session (see client.ts's `SessionEndReason` doc comment).
  useEffect(
    () =>
      onSessionEnded(() => {
        setUser(null);
        setRiderCapability(null);
        setNotice(SESSION_ENDED_MESSAGE);
        setStatus('anonymous');
      }),
    []
  );

  const requestOtp = useCallback(async (phone: string) => {
    const data = await authApi.requestOtp(phone);
    return { devOtp: data.dev_otp };
  }, []);

  // Both sign-in methods end here: the same role gate, the same session.
  const completeSignIn = useCallback(async (data: { access_token: string; refresh_token: string; user: AuthUser }) => {
    if (!isOperator(data.user)) {
      tokenStore.clear();
      throw new ApiError(WRONG_ROLE_MESSAGE, 403, 'FORBIDDEN');
    }
    tokenStore.save(data.access_token, data.refresh_token);
    const capability = await probeRiderCapability();
    setNotice(null);
    setUser(data.user);
    setRiderCapability(capability);
    setStatus('authenticated');
  }, []);

  const verifyOtp = useCallback(
    async (phone: string, otp: string) => completeSignIn(await authApi.verifyOtp(phone, otp)),
    [completeSignIn]
  );

  const signInWithPassword = useCallback(
    async (email: string, password: string) => completeSignIn(await authApi.staffLogin(email, password)),
    [completeSignIn]
  );

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Signing out locally matters more than the server round trip.
    }
    // Location sharing belongs to this signed-in rider profile: never past sign-out.
    stopTracking().catch(() => undefined);
    tokenStore.clear();
    setUser(null);
    setRiderCapability(null);
    setNotice(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      status,
      notice,
      riderCapability,
      refreshRiderCapability,
      requestOtp,
      verifyOtp,
      signInWithPassword,
      signOut,
    }),
    [user, status, notice, riderCapability, refreshRiderCapability, requestOtp, verifyOtp, signInWithPassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
