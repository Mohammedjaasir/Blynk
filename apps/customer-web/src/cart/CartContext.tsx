import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '../api/types';
import { loadCart, saveCart, setQuantity, quantityOf, itemCount, subtotal, type CartState } from './cartStore';

interface CartApi { state: CartState; add(p: Product): void; remove(p: Product): void; setQty(p: Product, n: number): void; qty(id: string): number; count: number; subtotal: number }
const Ctx = createContext<CartApi | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(() => loadCart());
  useEffect(() => saveCart(state), [state]);
  const api = useMemo<CartApi>(() => ({
    state,
    add: (p) => setState((s) => setQuantity(s, p, quantityOf(s, p.id) + 1)),
    remove: (p) => setState((s) => setQuantity(s, p, quantityOf(s, p.id) - 1)),
    setQty: (p, n) => setState((s) => setQuantity(s, p, n)),
    qty: (id) => quantityOf(state, id),
    count: itemCount(state),
    subtotal: subtotal(state),
  }), [state]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
export function useCart(): CartApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCart outside CartProvider');
  return c;
}
