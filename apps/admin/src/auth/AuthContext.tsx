import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, tokenStore } from '../api/client';
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
  status: 'loading' | 'authenticated' | 'anonymous';
  requestOtp(phone: string): Promise<{ devOtp?: string }>;
  verifyOtp(phone: string, otp: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const NOT_ADMIN_MESSAGE =
  'This account is not a Blynk operations account.';

/**
 * Roles with an operations session: admins (everything here) and packing
 * staff (Orders only - the documented admin/staff dashboard, dispatch D12).
 * A courtesy check; the API guards every route by role.
 */
export const OPERATIONS_ROLES: ReadonlyArray<AuthUser['role']> = ['ADMIN', 'PACKING_STAFF'];
const isOperations = (user: AuthUser) => OPERATIONS_ROLES.includes(user.role);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');

  // Restore an existing session on load, and drop it if the account is not
  // (or is no longer) an operations account.
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
        if (!isOperations(me)) {
          tokenStore.clear();
          setStatus('anonymous');
          return;
        }
        setUser(me);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        tokenStore.clear();
        setStatus('anonymous');
      }
    }
    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    const data = await authApi.requestOtp(phone);
    return { devOtp: data.dev_otp };
  }, []);

  const verifyOtp = useCallback(async (phone: string, otp: string) => {
    const data = await authApi.verifyOtp(phone, otp);
    if (!isOperations(data.user)) {
      tokenStore.clear();
      throw new ApiError(NOT_ADMIN_MESSAGE, 403, 'FORBIDDEN');
    }
    tokenStore.save(data.access_token, data.refresh_token);
    setUser(data.user);
    setStatus('authenticated');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Signing out locally matters more than the server round trip.
    }
    tokenStore.clear();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, status, requestOtp, verifyOtp, signOut }),
    [user, status, requestOtp, verifyOtp, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
