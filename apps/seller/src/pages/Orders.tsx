import { useEffect, useMemo, useRef, useState } from 'react';
import { useOrders, usePollOrders } from '../auth/OrdersContext';
import { useSeller } from '../auth/SellerContext';
import { Illustration } from '../components/Illustration';
import { OrderCard } from '../components/OrderCard';
import { EmptyState, ErrorState, Eyebrow, PageLoading } from '../components/ui';
import { isOpen } from '../lib/orders';

type Tab = 'open' | 'earlier';

/**
 * Orders: the orders that contain this shop's products, newest first (GET /seller/orders). It
 * refreshes every 30 seconds while open and whenever a push arrives. Open orders (new, ready, on
 * the way) come first; delivered and cancelled ones are under "Earlier". A tap on a new-order
 * notification opens this page (the notification carries /orders).
 */
export function Orders() {
  const { canSell } = useSeller();
  const { orders, error, reload, replace, newCount } = useOrders();
  const [tab, setTab] = useState<Tab>('open');
  usePollOrders();

  // Coming from another tab with orders already in hand: look again straight away.
  const hadOrders = useRef(orders !== null);
  useEffect(() => {
    if (hadOrders.current) void reload();
  }, [reload]);

  const open = useMemo(() => (orders ?? []).filter(isOpen), [orders]);
  const earlier = useMemo(() => (orders ?? []).filter((o) => !isOpen(o)), [orders]);
  const shown = tab === 'open' ? open : earlier;

  return (
    <section aria-labelledby="orders-title" className="orders">
      <div className="page__head">
        <div className="page__titles">
          <Eyebrow>Your shop</Eyebrow>
          <h1 id="orders-title">Orders</h1>
          <p className="muted page__sub">
            {newCount > 0
              ? `${newCount} new ${newCount === 1 ? 'order is' : 'orders are'} waiting. Pack it, then tap "Order is ready" so the rider can collect it.`
              : 'Orders for your products show up here. You will get a notification when one comes in.'}
          </p>
        </div>
      </div>

      {!canSell ? (
        <p className="muted catalogue__blocked">You get orders once Blynk has approved your shop.</p>
      ) : error && orders === null ? (
        <ErrorState message={error} onRetry={() => void reload()} />
      ) : orders === null ? (
        <PageLoading label="Loading your orders" />
      ) : (
        <>
          <div
            className="toggle orders__tabs"
            role="group"
            aria-label="Which orders to show"
            style={{ ['--index' as string]: tab === 'open' ? 0 : 1 }}
          >
            <span className="toggle__thumb" aria-hidden="true" />
            <button type="button" className="toggle__option" aria-pressed={tab === 'open'} onClick={() => setTab('open')}>
              Open ({open.length})
            </button>
            <button type="button" className="toggle__option" aria-pressed={tab === 'earlier'} onClick={() => setTab('earlier')}>
              Earlier ({earlier.length})
            </button>
          </div>

          {shown.length === 0 ? (
            <EmptyState
              art={<Illustration name="crate" />}
              title={tab === 'open' ? 'No open orders' : 'No earlier orders'}
              message={
                tab === 'open'
                  ? 'When a customer orders your products, the order shows here and you get a notification.'
                  : 'Delivered and cancelled orders from the last 60 days show here.'
              }
            />
          ) : (
            <ul className="olist">
              {shown.map((order, index) => (
                <li key={order.id} className="rise" style={{ ['--i' as string]: Math.min(index, 8) }}>
                  <OrderCard order={order} onChanged={replace} onRefresh={() => void reload()} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
