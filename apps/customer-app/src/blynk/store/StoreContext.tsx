import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getStore } from '../api/catalog';
import type { StoreInfo } from '../api/types';
import { appHidden, onVisible } from '../lib/visibility';

/** GET /store, refreshed every 30 s while visible and whenever the app comes back. null until it loads. */
export const StoreContext = createContext<StoreInfo | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<StoreInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getStore().then((d) => { if (alive) setS(d); }).catch(() => {});
    void load();
    const t = setInterval(() => { if (!appHidden()) void load(); }, 30_000);
    const off = onVisible(() => void load());
    return () => { alive = false; clearInterval(t); off(); };
  }, []);
  return <StoreContext.Provider value={s}>{children}</StoreContext.Provider>;
}
export const useStore = () => useContext(StoreContext);
