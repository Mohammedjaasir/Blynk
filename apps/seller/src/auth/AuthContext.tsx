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
import { auth as authApi, type SessionPayload } from '../api/resources';
import type { AuthUser } from '../api/types';

/**
 * Seller session, built on the existing Blynk phone + SMS code sign-in with
 * `app: 'seller'`, or on the seller email + password routes
 * (/auth/seller/login-email, /auth/seller/register-email), which return the
 * same tokens. Only SELLER users hold a session here; anyone else is
 * signed straight back out. A courtesy check: the API guards every /seller
 * route by role whatever this app renders.
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
  retry(): void;
  /** Check the SMS code. `shopName` is only used the first time a number signs in. */
  signIn(phone: string, otp: string, shopName?: string): Promise<void>;
  /** Sign in with an email and password. */
  signInWithEmail(email: string, password: string): Promise<void>;
  /** Create a seller account with an email, password and shop name, and sign in. */
  registerWithEmail(email: string, password: string, shopName: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';
export const NOT_SELLER_MESSAGE = 'This number is not a Blynk seller account.';
export const NOT_SELLER_EMAIL_MESSAGE = 'This email is not a Blynk seller account.';

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

  // Restore an existing session on load.
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
        if (me.role !== 'SELLER') {
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

  // Every sign-in route returns the same payload; only a SELLER keeps it.
  const adopt = useCallback((data: SessionPayload, notSellerMessage: string) => {
    if (data.user.role !== 'SELLER') {
      tokenStore.clear();
      throw new ApiError(notSellerMessage, 403, 'FORBIDDEN');
    }
    tokenStore.save(data.access_token, data.refresh_token);
    setSessionEnded(false);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const signIn = useCallback(
    async (phone: string, otp: string, shopName?: string) => {
      adopt(await authApi.verifyOtp(phone, otp, shopName), NOT_SELLER_MESSAGE);
    },
    [adopt]
  );

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      adopt(await authApi.loginEmail(email, password), NOT_SELLER_EMAIL_MESSAGE);
    },
    [adopt]
  );

  const registerWithEmail = useCallback(
    async (email: string, password: string, shopName: string) => {
      adopt(await authApi.registerEmail(email, password, shopName), NOT_SELLER_EMAIL_MESSAGE);
    },
    [adopt]
  );

  const signOut = useCallback(async () => {
    signingOut.current = true;
    try {
      await authApi.logout();
    } catch {
      // Signing out on this phone matters more than the server round trip.
    } finally {
      signingOut.current = false;
    }
    tokenStore.clear();
    setSessionEnded(false);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, status, sessionEnded, retry, signIn, signInWithEmail, registerWithEmail, signOut }),
    [user, status, sessionEnded, retry, signIn, signInWithEmail, registerWithEmail, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
