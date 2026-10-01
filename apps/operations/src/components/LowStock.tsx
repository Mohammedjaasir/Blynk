import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { inventory as inventoryApi } from '../api/resources';
import type { LowStockResult } from '../api/types';
import { inventoryErrorMessage } from '../lib/inventory';

/**
 * Low-stock alerts (`GET /admin/inventory/low-stock`), fetched ONCE when the
 * signed-in shell mounts and shared by everything that shows them - the
 * Catalog tab's badge, Home's "Needs a look" and the Running low list - so
 * moving between screens never re-asks. `refresh()` re-reads it on demand
 * (Home's Refresh button, after a restock or threshold change).
 */
interface LowStockState {
  data: LowStockResult | null;
  error: string | null;
  refresh(): Promise<void>;
}

const LowStockContext = createContext<LowStockState | null>(null);

export function LowStockProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<LowStockResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await inventoryApi.stock.lowStock());
      setError(null);
    } catch (err) {
      setError(inventoryErrorMessage(err, 'Could not load low-stock alerts.'));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ data, error, refresh }), [data, error, refresh]);
  return <LowStockContext.Provider value={value}>{children}</LowStockContext.Provider>;
}

const NO_PROVIDER: LowStockState = { data: null, error: null, refresh: async () => undefined };

export function useLowStock(): LowStockState {
  return useContext(LowStockContext) ?? NO_PROVIDER;
}
