import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { orders as ordersApi } from '../api/resources';
import type { OrderDetail } from '../api/types';
import { formatMoney, orderErrorMessage } from '../lib/orders';
import { formatPhone } from '../lib/format';

const slipDate = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Colombo',
});

/** Cash the rider collects at the door: the total for an unpaid COD order, else nothing. */
export function codToCollect(order: Pick<OrderDetail, 'payment_method' | 'payment_status' | 'total_amount'>): number {
  return order.payment_method === 'COD' && order.payment_status !== 'PAID' ? order.total_amount : 0;
}

/**
 * Printing is window.print() with a print stylesheet (styles.css `@media
 * print`). The Android app is a Capacitor WebView, and Android's WebView does
 * not implement window.print() (it is a silent no-op; printing there needs the
 * native PrintManager, which this app has no plugin for). So inside the
 * Android app the slip is still shown as a print-friendly page, and the
 * operator is told to print it from a browser instead.
 */
export const canPrintHere = () => !(Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android');

/**
 * The packing slip for one order, print-friendly (`/orders/:id/slip`, opened
 * from the order's "Print packing slip" button): order number and date, the
 * customer's name, phone and address, delivery notes, the items (qty, name,
 * unit), the bill (items, delivery, any coupon discount), the total and the
 * cash to collect (= the total), and the Blynk name. Items that
 * came off the bill (unavailable) are left out.
 */
export function PackingSlip() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setOrder(await ordersApi.detail(id));
      setError(null);
    } catch (err) {
      setError(orderErrorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const back = (
    <Link to={`/orders/${id}`} className="link">
      ← Back to the order
    </Link>
  );

  if (!order) {
    return (
      <div className="page">
        {back}
        {error ? (
          <>
            <p className="field__error">{error}</p>
            <button type="button" className="button" onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : (
          <p className="loading" role="status">
            Loading the packing slip…
          </p>
        )}
      </div>
    );
  }

  const items = order.items.filter((item) => item.item_status !== 'UNAVAILABLE');
  const cod = codToCollect(order);
  const printable = canPrintHere();
  const address = [order.delivery_address_line1, order.delivery_address_line2, order.delivery_city, order.delivery_postal_code]
    .filter(Boolean)
    .join(', ');
  const notes = [order.delivery_instructions, order.customer_notes].filter((n): n is string => Boolean(n && n.trim()));

  return (
    <div className="page slip-page">
      <div className="slip-toolbar no-print">
        {back}
        {printable ? (
          <button type="button" className="button" onClick={() => window.print()}>
            Print
          </button>
        ) : (
          <p className="page__note" role="status">
            Printing isn't available inside the Android app. Open this order in Blynk Operations in a browser to print
            the slip.
          </p>
        )}
      </div>

      <article className="packing-slip" aria-label="Packing slip">
        <header className="packing-slip__head">
          <p className="packing-slip__brand">Blynk</p>
          <div>
            <h1 className="packing-slip__title">Packing slip</h1>
            <p className="packing-slip__number mono">{order.order_number}</p>
            <p className="packing-slip__meta">{slipDate.format(new Date(order.placed_at))}</p>
          </div>
        </header>

        <section className="packing-slip__section" aria-label="Deliver to">
          <h2 className="packing-slip__label">Deliver to</h2>
          <p className="packing-slip__strong">{order.delivery_recipient_name}</p>
          <p className="mono">{formatPhone(order.delivery_recipient_phone)}</p>
          {order.delivery_alternate_phone ? (
            <p>
              Additional phone: <span className="mono">{formatPhone(order.delivery_alternate_phone)}</span>
            </p>
          ) : null}
          <p>{address}</p>
        </section>

        {notes.length > 0 ? (
          <section className="packing-slip__section" aria-label="Delivery notes">
            <h2 className="packing-slip__label">Delivery notes</h2>
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </section>
        ) : null}

        <table className="packing-slip__items">
          <thead>
            <tr>
              <th scope="col">Qty</th>
              <th scope="col">Item</th>
              <th scope="col">Unit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="mono">{item.quantity}</td>
                <td>{item.product_name_snapshot}</td>
                <td>{item.unit_snapshot ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="packing-slip__totals">
          {order.subtotal_amount != null ? (
            <div>
              <dt>Items</dt>
              <dd className="mono">{formatMoney(order.subtotal_amount)}</dd>
            </div>
          ) : null}
          {order.delivery_fee != null ? (
            <div>
              <dt>Delivery</dt>
              <dd className="mono">{formatMoney(order.delivery_fee)}</dd>
            </div>
          ) : null}
          {(order.discount_amount ?? 0) > 0 ? (
            <div className="packing-slip__discount">
              <dt>Discount{order.coupon_code ? ` (${order.coupon_code})` : ''}</dt>
              <dd className="mono">−{formatMoney(order.discount_amount!)}</dd>
            </div>
          ) : null}
          <div>
            <dt>Total</dt>
            <dd className="mono">{formatMoney(order.total_amount)}</dd>
          </div>
          <div className="packing-slip__cod">
            <dt>Cash to collect (COD)</dt>
            <dd className="mono">{cod > 0 ? formatMoney(cod) : 'Nothing - already paid'}</dd>
          </div>
        </dl>

        <p className="packing-slip__foot">Thank you for shopping with Blynk.</p>
      </article>
    </div>
  );
}
