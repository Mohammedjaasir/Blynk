import { useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { deliveriesApi } from '../api/resources';
import type { DeliverySummary } from '../api/types';
import { Banner } from '../components/Banner';
import { Header } from '../components/Header';
import { splitQueue, statusLabel, statusTone } from '../lib/delivery';
import { errorMessage } from '../lib/errors';
import { formatMoney, shortOrderNumber } from '../lib/format';
import { useLoad } from '../lib/useLoad';
import { useRevalidate } from '../lib/useRevalidate';

export const owesCash = (d: DeliverySummary) => d.payment_method === 'COD' && d.payment_status === 'PENDING';

/**
 * Home answers one question: what do I act on now? The delivery furthest
 * along gets the page; the rest are one line each; today's finished work is
 * a single summary line. Everything shown comes from GET /riders/deliveries.
 */
export function Queue() {
  const { data, error, loading, loadedAt, reload } = useLoad(() => deliveriesApi.list(), []);
  const refresh = useCallback(() => void reload(), [reload]);
  useRevalidate(refresh);

  const queue = data ? splitQueue(data) : null;
  // Set by the delivery screen when it had to send the rider back here.
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  return (
    <>
      <Header onRefresh={refresh} refreshing={loading} refreshLabel="Refresh deliveries" />
      <main className="page">
        {notice ? <Banner message={notice} /> : null}
        {error ? <Banner message={errorMessage(error)} stamp={data ? loadedAt : null} onRetry={refresh} /> : null}

        {!queue && !error ? (
          <p className="page__loading" role="status">
            Loading your deliveries…
          </p>
        ) : null}

        {queue ? (
          <>
            {queue.now ? <NowSlip delivery={queue.now} /> : null}

            {!queue.now && queue.next.length === 0 ? (
              <section className="empty">
                <p className="empty__title">No deliveries assigned to you right now.</p>
                <p className="empty__body">
                  The store assigns deliveries. This page checks for new ones every 30 seconds.
                </p>
                <button type="button" className="secondary" onClick={refresh} disabled={loading}>
                  Check again
                </button>
              </section>
            ) : null}

            {!queue.now && queue.next.length > 0 ? (
              <p className="page__note">Nothing to pick up yet. The orders below are waiting on the store.</p>
            ) : null}

            {queue.next.length > 0 ? (
              <section className="list" aria-labelledby="next-heading">
                <h2 id="next-heading" className="eyebrow">
                  Next
                </h2>
                <ul className="list__rows">
                  {queue.next.map((d) => (
                    <li key={d.delivery_id}>
                      <Link to={`/deliveries/${d.delivery_id}`} className="row">
                        <span className="row__number">#{shortOrderNumber(d.order_number)}</span>
                        <span className="row__where">
                          <span className="row__place">{d.delivery_address_line1}</span>
                          <span className={`row__status tone--${statusTone(d)}`}>{statusLabel(d)}</span>
                        </span>
                        <span className="row__amount">{formatMoney(d.total_amount)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {queue.done.length > 0 ? (
              <section className="done" aria-labelledby="done-heading">
                <h2 id="done-heading" className="eyebrow">
                  Done today
                </h2>
                <p className="done__line">
                  <span className="done__tick" aria-hidden="true" />
                  {queue.done.length} delivered · {formatMoney(queue.collectedToday)} collected
                </p>
                <p className="done__numbers">
                  {queue.done.map((d) => `#${shortOrderNumber(d.order_number)}`).join('   ')}
                </p>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
    </>
  );
}

function NowSlip({ delivery: d }: { delivery: DeliverySummary }) {
  const number = shortOrderNumber(d.order_number);
  return (
    <section className="slip" aria-labelledby="now-heading">
      <div className="slip__top">
        <h2 id="now-heading" className="eyebrow eyebrow--strong">
          Now
        </h2>
        <span className={`slip__state tone--${statusTone(d)}`}>{statusLabel(d)}</span>
      </div>
      <p className="slip__dest">{d.delivery_address_line1}</p>
      {d.delivery_address_line2 ? <p className="slip__dest-2">{d.delivery_address_line2}</p> : null}
      <p className="slip__meta">
        <span className="mono">#{number}</span>
        <span>{d.delivery_recipient_name}</span>
        <span>{d.delivery_city}</span>
      </p>
      {owesCash(d) ? (
        <p className="slip__cash">
          <span className="slip__cash-label">Cash to collect</span>
          <span className="slip__cash-amount">{formatMoney(d.total_amount)}</span>
        </p>
      ) : null}
      <Link to={`/deliveries/${d.delivery_id}`} className="primary" aria-label={`Open delivery #${number}`}>
        Open delivery
      </Link>
    </section>
  );
}
