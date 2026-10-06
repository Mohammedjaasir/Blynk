import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, onSessionEnded, tokenStore } from '../api/client';
import { auth as authApi } from '../api/resources';
import type { AuthUser } from '../api/types';

/**
 * Admin session, built on the existing Blynk OTP authentication - there is
 * no separate admin auth system. Only ADMIN users are allowed to hold a
 * session here; anyone else is signed straight back out.
 *
 * This gate is a courtesy to the operator, not a security boundary: the API
 * rejects non-admin tokens on every admin route regardless of what this app
 * chooses to render.
 */
interface AuthState {
  user: AuthUser | null;
  /**
   * `unreachable`: a stored session could not be checked because the API did
   * not answer. The tokens are kept (nothing refused them) and `retry` tries again.
   */
  status: 'loading' | 'authenticated' | 'anonymous' | 'unreachable';
  /** The server ended the session (refresh refused); sign-in says so. */
  sessionEnded: boolean;
  /** Re-check a stored session after `unreachable`. */
  retry(): void;
  requestOtp(phone: string): Promise<{ devOtp?: string }>;
  verifyOtp(phone: string, otp: string): Promise<void>;
  /** Staff email + password sign-in - the same role gate as an SMS code. */
  signInWithPassword(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again.';

export const NOT_ADMIN_MESSAGE =
  'This account is not a Blynk operations account.';
/** Staff accounts each have one app (backend migration 014). */
export const INVENTORY_STAFF_MESSAGE =
  'Blynk Admin is for admins only. Inventory staff sign in to the Blynk Inventory site.';
export const OPERATIONS_STAFF_MESSAGE =
  'Blynk Admin is for admins only. Operations staff sign in to the Blynk Operations app.';

/** Why `role` cannot use Blynk Admin, pointing staff to their own app. */
export function wrongAppMessage(role: AuthUser['role']): string {
  if (role === 'PACKING_STAFF') return INVENTORY_STAFF_MESSAGE;
  if (role === 'OPERATIONS') return OPERATIONS_STAFF_MESSAGE;
  return NOT_ADMIN_MESSAGE;
}

/**
 * Only admins hold a session here (2026-09-30). Packing staff use the
 * Inventory site and Operations staff the Operations app; both are sent
 * there by wrongAppMessage(). A courtesy check; the API guards every route
 * by role.
 */
export const OPERATIONS_ROLES: ReadonlyArray<AuthUser['role']> = ['ADMIN'];
const isOperations = (user: AuthUser) => OPERATIONS_ROLES.includes(user.role);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [sessionEnded, setSessionEnded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const signingOut = useRef(false);
  const statusRef = useRef(status);
  statusRef.current = status;

  // The API client clears the tokens when the server refuses a refresh; the
  // app has to follow, or every signed-in page would just keep erroring.
  useEffect(
    () =>
      onSessionEnded(() => {
        if (signingOut.current || statusRef.current === 'anonymous') return;
        setUser(null);
        setSessionEnded(true);
        setStatus('anonymous');
      }),
    []
  );

  // Restore an existing session on load, and drop it if the account is not
  // (or is no longer) an operations account.
  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!tokenStore.access) {
        if (!cancelled) setStatus('anonymous');
        return;
      }
      setStatus('loading');
      try {
        const me = await authApi.me();
        if (cancelled) return;
        if (!isOperations(me)) {
          tokenStore.clear();
          setStatus('anonymous');
          return;
        }
        setUser(me);
        setStatus('authenticated');
      } catch (err) {
        if (cancelled) return;
        // No answer is not a refusal: keep the session and offer a retry.
        if (err instanceof ApiError && (err.code === 'NETWORK' || err.code === 'REFRESH_UNAVAILABLE' || err.status >= 500)) {
          setStatus('unreachable');
          return;
        }
        tokenStore.clear();
        setStatus('anonymous');
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  const requestOtp = useCallback(async (phone: string) => {
    const data = await authApi.requestOtp(phone);
    return { devOtp: data.dev_otp };
  }, []);

  // Both sign-in methods end here: the same role gate, the same session.
  const completeSignIn = useCallback(async (data: { access_token: string; refresh_token: string; user: AuthUser }) => {
    if (!isOperations(data.user)) {
      tokenStore.clear();
      throw new ApiError(wrongAppMessage(data.user.role), 403, 'FORBIDDEN');
    }
    tokenStore.save(data.access_token, data.refresh_token);
    setSessionEnded(false);
    setUser(data.user);
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
    signingOut.current = true;
    try {
      await authApi.logout();
    } catch {
      // Signing out locally matters more than the server round trip.
    } finally {
      signingOut.current = false;
    }
    tokenStore.clear();
    setSessionEnded(false);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, status, sessionEnded, retry, requestOtp, verifyOtp, signInWithPassword, signOut }),
    [user, status, sessionEnded, retry, requestOtp, verifyOtp, signInWithPassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
