import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { sellerApi } from '../api/resources';
import type { SellerOrder } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { newOrderCount } from '../lib/orders';
import { pushManager } from '../lib/push';
import type { PushManager } from '../lib/push/manager';
import { useSeller } from './SellerContext';

/** How often the Orders tab asks for fresh orders while it is open. */
export const ORDERS_POLL_MS = 30_000;
/** How often the badge on the tab is refreshed while another tab is open. */
export const BADGE_POLL_MS = 60_000;

/**
 * The seller's orders (GET /seller/orders), kept in one place so the Orders tab and the badge on
 * its tab icon agree. Only an APPROVED shop has orders (the API refuses the rest), so nothing is
 * asked before approval. It refreshes when the app comes back to the screen and whenever a push
 * arrives while the app is open; the Orders page adds its own 30 second poll (usePollOrders).
 * A failed refresh keeps what is already shown.
 */
interface OrdersState {
  orders: SellerOrder[] | null;
  /** Set only while there is nothing to show (the first load failed). */
  error: string | null;
  newCount: number;
  reload(): Promise<void>;
  /** Swap one order for the server's newer copy (after "Order is ready"). */
  replace(order: SellerOrder): void;
}

const OrdersContext = createContext<OrdersState | null>(null);

export function OrdersProvider({
  children,
  manager = pushManager,
}: {
  children: ReactNode;
  manager?: PushManager;
}) {
  const { canSell } = useSeller();
  const [orders, setOrders] = useState<SellerOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const reload = useCallback(async () => {
    if (!canSell) return;
    try {
      const next = await sellerApi.orders();
      loaded.current = true;
      setOrders(next);
      setError(null);
    } catch (err) {
      if (!loaded.current) setError(errorMessage(err, 'Could not load your orders. Please try again.'));
    }
  }, [canSell]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // A push while the app is open usually means a new order: look straight away.
  useEffect(() => manager.onForeground(() => void reload()), [manager, reload]);

  useEffect(() => {
    if (!canSell) return;
    const timer = setInterval(() => void reload(), BADGE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void reload();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [canSell, reload]);

  const replace = useCallback((order: SellerOrder) => {
    setOrders((current) => (current ? current.map((o) => (o.id === order.id ? order : o)) : current));
  }, []);

  const value = useMemo<OrdersState>(
    () => ({ orders, error, newCount: orders ? newOrderCount(orders) : 0, reload, replace }),
    [orders, error, reload, replace]
  );
  return <OrdersContext.Provider value={value}>{children}</OrdersContext.Provider>;
}

export function useOrders(): OrdersState {
  const context = useContext(OrdersContext);
  if (!context) throw new Error('useOrders must be used inside OrdersProvider');
  return context;
}

/** While the Orders page is open: refresh every 30 seconds. */
export function usePollOrders(ms: number = ORDERS_POLL_MS) {
  const { reload } = useOrders();
  useEffect(() => {
    const timer = setInterval(() => void reload(), ms);
    return () => clearInterval(timer);
  }, [reload, ms]);
}
