import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { featureErrorMessage, repeatBaskets as repeatApi, type AdminRepeatBasket, type RepeatBasketStatus } from '../api/engagement';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Spinner, useToast } from '../components/ui';
import {
  BASKET_STATUS_LABEL,
  BASKET_STATUS_TONE,
  RUN_STATUS_LABEL,
  basketCustomer,
  basketItemsCount,
  basketItemsPreview,
  scheduleText,
  whenText,
} from '../lib/engagement';
import { shortNumber } from '../lib/orders';
import './engagement.css';

/**
 * Repeat baskets (owner, 2026-10-24: "deliver this basket every Monday", a daily milk and bread
 * subscription). Customers set them up in the app; the server places each order at its time. Here
 * staff see every basket and can pause, resume or cancel one. Blynk Ops has the same page.
 */
type Filter = RepeatBasketStatus | 'ALL';
const FILTERS: Filter[] = ['ALL', 'ACTIVE', 'PAUSED', 'CANCELLED'];
const FILTER_LABEL: Record<Filter, string> = { ALL: 'All', ...BASKET_STATUS_LABEL };

type Change = { basket: AdminRepeatBasket; to: RepeatBasketStatus };

const STATUS_ORDER: Record<RepeatBasketStatus, number> = { ACTIVE: 0, PAUSED: 1, CANCELLED: 2 };
const sortBaskets = (rows: AdminRepeatBasket[]) =>
  [...rows].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (Date.parse(a.next_run_at ?? '') || Infinity) - (Date.parse(b.next_run_at ?? '') || Infinity)
  );

export function RepeatBaskets() {
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [rows, setRows] = useState<AdminRepeatBasket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await repeatApi.list(filter === 'ALL' ? undefined : filter);
      setRows(sortBaskets(list));
      setError(null);
    } catch (err) {
      setError(featureErrorMessage(err, 'Could not load the repeat baskets.'));
      setRows([]);
    }
  }, [filter]);

  useEffect(() => {
    setRows(null);
    void load();
  }, [load]);

  async function apply({ basket, to }: Change) {
    setChange(null);
    setBusyId(basket.id);
    try {
      await repeatApi.setStatus(basket.id, to);
      toast.success(to === 'PAUSED' ? 'Basket paused.' : to === 'ACTIVE' ? 'Basket resumed.' : 'Basket cancelled.');
      await load();
    } catch (err) {
      toast.error(featureErrorMessage(err, 'Could not change the basket.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Repeat baskets"
        description="Baskets customers asked to be delivered again and again (every day, every week or every 2 weeks). Each order is placed by itself at its time as cash on delivery."
        actions={
          <div className="segmented" role="group" aria-label="Show">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                className={f === filter ? 'segmented__item is-selected' : 'segmented__item'}
                aria-pressed={f === filter}
                onClick={() => setFilter(f)}
              >
                {FILTER_LABEL[f]}
              </button>
            ))}
          </div>
        }
      />

      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading the repeat baskets" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState
            title={filter === 'ALL' ? 'No repeat baskets yet' : `No ${FILTER_LABEL[filter].toLowerCase()} baskets`}
            message={filter === 'ALL' ? 'Customers set them up in the app from a delivered order or their cart.' : undefined}
          />
        )
      ) : (
        <div className="table-wrap">
          <table className="table" aria-label="Repeat baskets">
            <thead>
              <tr>
                <th scope="col">Basket</th>
                <th scope="col">Customer</th>
                <th scope="col">Items</th>
                <th scope="col">Schedule</th>
                <th scope="col">Next order</th>
                <th scope="col">Last run</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const who = basketCustomer(b);
                const count = basketItemsCount(b);
                const preview = basketItemsPreview(b);
                const run = b.last_run ?? null;
                const busy = busyId === b.id;
                return (
                  <tr key={b.id}>
                    <td className="cell__primary">{b.name}</td>
                    <td>
                      <span className="cell__primary">{who.name ?? 'Customer'}</span>
                      {who.phone ? (
                        <>
                          <br />
                          <a className="cell__secondary" href={`tel:${who.phone}`}>
                            {who.phone}
                          </a>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {count} {count === 1 ? 'item' : 'items'}
                      {preview ? <div className="cell__secondary">{preview}</div> : null}
                    </td>
                    <td>{scheduleText(b)}</td>
                    <td>
                      {b.status === 'ACTIVE' ? whenText(b.next_run_at) : '—'}
                      {b.status === 'ACTIVE' && b.skip_next ? <div className="cell__secondary">Next one skipped by the customer</div> : null}
                    </td>
                    <td>
                      {run ? (
                        <>
                          <span className={`run-chip run-chip--${run.status.toLowerCase()}`}>{RUN_STATUS_LABEL[run.status] ?? run.status}</span>{' '}
                          <span className="cell__secondary">{whenText(run.run_at)}</span>
                          {run.order_id ? (
                            <div>
                              <Link to={`/orders/${run.order_id}`}>Order{run.order_number ? ` #${shortNumber(run.order_number)}` : ''}</Link>
                            </div>
                          ) : null}
                          {run.reason ? <div className="cell__secondary">{run.reason}</div> : null}
                        </>
                      ) : b.last_run_at ? (
                        <span className="cell__secondary">{whenText(b.last_run_at)}</span>
                      ) : (
                        <span className="cell__secondary">Not run yet</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={BASKET_STATUS_TONE[b.status]}>{BASKET_STATUS_LABEL[b.status] ?? b.status}</Badge>
                    </td>
                    <td>
                      <div className="row-actions">
                        {b.status === 'ACTIVE' ? (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            disabled={busy}
                            aria-label={`Pause ${b.name} of ${who.name ?? 'customer'}`}
                            onClick={() => setChange({ basket: b, to: 'PAUSED' })}
                          >
                            Pause
                          </button>
                        ) : null}
                        {b.status === 'PAUSED' ? (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            disabled={busy}
                            aria-label={`Resume ${b.name} of ${who.name ?? 'customer'}`}
                            onClick={() => setChange({ basket: b, to: 'ACTIVE' })}
                          >
                            Resume
                          </button>
                        ) : null}
                        {b.status !== 'CANCELLED' ? (
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            disabled={busy}
                            aria-label={`Cancel ${b.name} of ${who.name ?? 'customer'}`}
                            onClick={() => setChange({ basket: b, to: 'CANCELLED' })}
                          >
                            Cancel
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {change ? (
        <ConfirmDialog
          title={change.to === 'PAUSED' ? 'Pause basket' : change.to === 'ACTIVE' ? 'Resume basket' : 'Cancel basket'}
          message={confirmMessage(change)}
          confirmLabel={change.to === 'PAUSED' ? 'Pause' : change.to === 'ACTIVE' ? 'Resume' : 'Cancel basket'}
          destructive={change.to === 'CANCELLED'}
          onCancel={() => setChange(null)}
          onConfirm={() => void apply(change)}
        />
      ) : null}
    </>
  );
}

function confirmMessage({ basket, to }: Change): string {
  const who = basketCustomer(basket).name ?? 'the customer';
  if (to === 'PAUSED') return `Pause "${basket.name}" of ${who}? No orders are placed until it is resumed.`;
  if (to === 'ACTIVE') return `Resume "${basket.name}" of ${who}? Orders are placed again on its schedule (${scheduleText(basket)}).`;
  return `Cancel "${basket.name}" of ${who}? It stops for good; the customer would have to set it up again.`;
}
