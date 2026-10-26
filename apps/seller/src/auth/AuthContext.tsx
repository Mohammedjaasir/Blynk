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
import { pushManager } from '../lib/push';

/**
 * Seller session, built on the existing Blynk phone + SMS code sign-in with
 * `app: 'seller'`. Sellers are invite-only: Blynk staff register the shop's
 * number, and the server refuses any other number (403 SELLER_NOT_REGISTERED).
 * Only SELLER users hold a session here; anyone else is signed straight back
 * out. A courtesy check: the API guards every /seller route by role whatever
 * this app renders.
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
  /** Check the SMS code sent to the shop's registered number. */
  signIn(phone: string, otp: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';
export const NOT_SELLER_MESSAGE = 'This number is not a Blynk seller account.';

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
        // No session to unregister with: just let go of this device's token at Firebase.
        void pushManager.signedOut(null);
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

  // Push (installed-app notifications): start once a seller is signed in and, when the browser
  // already allows notifications, register this device quietly. Nothing here prompts.
  useEffect(() => {
    if (status !== 'authenticated') return;
    void pushManager.start().then(() => pushManager.signedIn());
  }, [status]);

  // Only a SELLER keeps the session the sign-in returns.
  const adopt = useCallback((data: SessionPayload) => {
    if (data.user.role !== 'SELLER') {
      tokenStore.clear();
      throw new ApiError(NOT_SELLER_MESSAGE, 403, 'FORBIDDEN');
    }
    tokenStore.save(data.access_token, data.refresh_token);
    setSessionEnded(false);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const signIn = useCallback(
    async (phone: string, otp: string) => {
      adopt(await authApi.verifyOtp(phone, otp));
    },
    [adopt]
  );

  const signOut = useCallback(async () => {
    signingOut.current = true;
    // Take this device off the seller's notifications while the session still works (the access
    // token is sent explicitly: logout revokes the session). A slow network must not hold up signing out.
    const accessToken = tokenStore.access;
    let giveUp: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      pushManager.signedOut(accessToken).catch(() => undefined),
      new Promise<void>((resolve) => {
        giveUp = setTimeout(resolve, 4000);
      }),
    ]);
    clearTimeout(giveUp);
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
    () => ({ user, status, sessionEnded, retry, signIn, signOut }),
    [user, status, sessionEnded, retry, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
