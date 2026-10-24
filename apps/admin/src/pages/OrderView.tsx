import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { orders as ordersApi } from '../api/resources';
import type { BoardOrder, OrderDetail } from '../api/types';
import { PageHeader } from '../components/Layout';
import { OrderPanel } from '../components/OrderPanel';
import { Spinner } from '../components/ui';
import { orderErrorMessage, shortNumber } from '../lib/orders';
import './engagement.css';

/**
 * One order by its id, read-only (2026-10-24): where Ratings and Repeat baskets link to, since the
 * Orders board only holds live orders. The same panel as the board, without its actions.
 */
export function OrderView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    ordersApi
      .detail(id)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        setError(null);
      })
      .catch((err) => live && setError(orderErrorMessage(err)));
    return () => {
      live = false;
    };
  }, [id]);

  return (
    <div className="order-view">
      <PageHeader
        title={detail ? `Order #${shortNumber(detail.order_number)}` : 'Order'}
        actions={
          <Link className="button button--ghost" to="/orders">
            Orders board
          </Link>
        }
      />
      {error ? (
        <p className="ops-notice" role="status">
          {error}
        </p>
      ) : null}
      {!detail && !error ? <Spinner label="Loading the order" /> : null}
      {detail ? (
        <OrderPanel
          order={asBoardOrder(detail)}
          role={undefined}
          version={0}
          busy={false}
          onAction={() => undefined}
          onClose={() => (window.history.length > 1 ? navigate(-1) : navigate('/orders'))}
        />
      ) : null}
    </div>
  );
}

/** The few board fields the panel reads, from the detail. */
function asBoardOrder(d: OrderDetail): BoardOrder {
  const count = (status: string) => d.items.filter((i) => i.item_status === status).length;
  return {
    id: d.id,
    order_number: d.order_number,
    order_status: d.order_status,
    total_amount: d.total_amount,
    wallet_amount_used: d.wallet_amount_used,
    placed_at: d.placed_at,
    updated_at: d.placed_at,
    scheduled_for: d.scheduled_for,
    scheduled_until: d.scheduled_until,
    delivery_recipient_name: d.delivery_recipient_name,
    delivery_address_line1: d.delivery_address_line1,
    delivery_city: d.delivery_city,
    items_summary: {
      total: d.items.length,
      pending: count('PENDING'),
      sourced: count('SOURCED'),
      packed: count('PACKED'),
      unavailable: count('UNAVAILABLE'),
      substituted: count('SUBSTITUTED'),
    },
    active_delivery: null,
    payment_method: d.payment_method,
    payment_status: d.payment_status,
    repeat_basket_id: d.repeat_basket_id ?? null,
  };
}
