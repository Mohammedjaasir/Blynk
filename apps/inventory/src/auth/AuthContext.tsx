import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, onSessionEnded, tokenStore } from '../api/client';
import { authApi } from '../api/resources';
import type { AuthUser } from '../api/types';
import { INVENTORY_ROLES } from './can';

interface AuthState {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  /** Why the last session ended, shown on the sign-in page. */
  notice: string | null;
  requestOtp(phone: string): Promise<{ devOtp?: string }>;
  verifyOtp(phone: string, otp: string): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const WRONG_ROLE_MESSAGE =
  'This account does not have access to Blynk Inventory. Inventory is for Blynk admins and packing staff.';
export const SESSION_ENDED_MESSAGE = 'Your session has ended. Please sign in again.';

/**
 * Sign-in over the existing Blynk OTP flow. Only ADMIN and PACKING_STAFF get
 * a session here; any other role is signed straight back out. That check is a
 * courtesy - every inventory endpoint is guarded by requireRoles server side.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [notice, setNotice] = useState<string | null>(null);

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
        if (!INVENTORY_ROLES.includes(me.role)) {
          tokenStore.clear();
          setNotice(WRONG_ROLE_MESSAGE);
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

  // The client clears the tokens when a refresh is refused; reflect that here
  // so the app returns to sign-in instead of showing a wall of 401s.
  useEffect(
    () =>
      onSessionEnded(() => {
        setUser(null);
        setNotice(SESSION_ENDED_MESSAGE);
        setStatus('anonymous');
      }),
    []
  );

  const requestOtp = useCallback(async (phone: string) => {
    const data = await authApi.requestOtp(phone);
    return { devOtp: data.dev_otp };
  }, []);

  const verifyOtp = useCallback(async (phone: string, otp: string) => {
    const data = await authApi.verifyOtp(phone, otp);
    if (!INVENTORY_ROLES.includes(data.user.role)) {
      tokenStore.clear();
      throw new ApiError(WRONG_ROLE_MESSAGE, 403, 'FORBIDDEN');
    }
    tokenStore.save(data.access_token, data.refresh_token);
    setNotice(null);
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
    () => ({ user, status, notice, requestOtp, verifyOtp, signOut }),
    [user, status, notice, requestOtp, verifyOtp, signOut]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
