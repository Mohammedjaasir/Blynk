import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getStore } from '../api/catalog';
import type { StoreInfo } from '../api/types';

export const StoreContext = createContext<StoreInfo | null>(null);
export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<StoreInfo | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => getStore().then((d) => alive && setS(d)).catch(() => {});
    void load();
    const t = setInterval(load, 30_000);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);
  return <StoreContext.Provider value={s}>{children}</StoreContext.Provider>;
}
export const useStore = () => useContext(StoreContext);
