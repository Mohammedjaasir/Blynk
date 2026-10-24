import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { sellerApi } from '../api/resources';
import type { Seller, SellerMe } from '../api/types';
import { errorMessage } from '../lib/apiErrors';

/**
 * The signed-in seller's shop (GET /seller/me): its approval status drives
 * the banner on every screen and whether products can be added or edited.
 * Only an APPROVED shop may add or edit products - the API enforces it too
 * (403 SELLER_NOT_APPROVED); this is the friendly version of the same rule.
 */
interface SellerState {
  seller: Seller | null;
  counts: SellerMe['counts'] | null;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  /** Only an APPROVED shop can add or change products. */
  canSell: boolean;
  reload(): Promise<void>;
  setSeller(seller: Seller): void;
}

const SellerContext = createContext<SellerState | null>(null);

export function SellerProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<SellerMe | null>(null);
  const [status, setStatus] = useState<SellerState['status']>('loading');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await sellerApi.me();
      setMe(data);
      setError(null);
      setStatus('ready');
    } catch (err) {
      setError(errorMessage(err, 'Could not load your shop. Please try again.'));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const setSeller = useCallback((seller: Seller) => {
    setMe((current) => ({ seller, counts: current?.counts ?? { products: 0, pending: 0 } }));
    setStatus('ready');
  }, []);

  const value = useMemo<SellerState>(
    () => ({
      seller: me?.seller ?? null,
      counts: me?.counts ?? null,
      status,
      error,
      canSell: me?.seller.status === 'APPROVED',
      reload,
      setSeller,
    }),
    [me, status, error, reload, setSeller]
  );

  return <SellerContext.Provider value={value}>{children}</SellerContext.Provider>;
}

export function useSeller(): SellerState {
  const context = useContext(SellerContext);
  if (!context) throw new Error('useSeller must be used inside SellerProvider');
  return context;
}
