import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { repeatBaskets, type RepeatStatus, type StaffRepeatBasket } from '../api/growth';
import { PageHeader } from '../components/Layout';
import { ConfirmDialog, EmptyState, Spinner, Status } from '../components/ui';
import '../components/growth.css';
import { REPEAT_STATUS_LABEL, colomboWhen, growthErrorMessage, isNotReady, runText, scheduleText } from '../lib/growth';

/**
 * More -> Repeat baskets (plan 2026-10-24-buy-again-repeat.md §2 staff API, §4): customers'
 * "deliver this basket every Monday" subscriptions. Staff can pause, resume or cancel one
 * (each asks first; the server audits REPEAT_BASKET_UPDATED). Orders a basket places show
 * a "Repeat" tag on the Orders board and the order screen.
 */

type Filter = RepeatStatus | 'ALL';
const FILTERS: { id: Filter; text: string }[] = [
  { id: 'ACTIVE', text: 'Active' },
  { id: 'PAUSED', text: 'Paused' },
  { id: 'CANCELLED', text: 'Cancelled' },
  { id: 'ALL', text: 'All' },
];

type Pending = { basket: StaffRepeatBasket; to: RepeatStatus };

const CONFIRM: Record<RepeatStatus, { title: string; message: (b: StaffRepeatBasket) => string; label: string }> = {
  PAUSED: {
    title: 'Pause this repeat basket?',
    message: (b) => `No orders are placed for "${b.name}" until it is resumed. The customer can resume it in the app.`,
    label: 'Pause',
  },
  ACTIVE: {
    title: 'Resume this repeat basket?',
    message: (b) => `"${b.name}" starts placing orders again on its schedule.`,
    label: 'Resume',
  },
  CANCELLED: {
    title: 'Cancel this repeat basket?',
    message: (b) => `"${b.name}" stops for good and no more orders are placed. This cannot be undone.`,
    label: 'Cancel basket',
  },
};

export function RepeatBaskets() {
  const [filter, setFilter] = useState<Filter>('ACTIVE');
  const [rows, setRows] = useState<StaffRepeatBasket[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (which: Filter) => {
    try {
      const list = await repeatBaskets.list(which === 'ALL' ? undefined : which);
      setRows(which === 'ALL' ? list : list.filter((b) => b.status === which));
      setError(null);
      setNotReady(false);
    } catch (err) {
      setRows([]);
      setNotReady(isNotReady(err));
      setError(growthErrorMessage(err, 'Could not load the repeat baskets.'));
    }
  }, []);

  useEffect(() => {
    setRows(null);
    void load(filter);
  }, [filter, load]);

  async function apply({ basket, to }: Pending) {
    setPending(null);
    setBusyId(basket.id);
    setNotice(null);
    try {
      await repeatBaskets.setStatus(basket.id, to);
      setNotice(
        to === 'PAUSED' ? `"${basket.name}" paused.` : to === 'ACTIVE' ? `"${basket.name}" resumed.` : `"${basket.name}" cancelled.`
      );
    } catch (err) {
      setNotice(growthErrorMessage(err, 'Could not change the repeat basket.'));
    } finally {
      setBusyId(null);
      await load(filter);
    }
  }

  return (
    <div className="page">
      <Link to="/more" className="link">
        ← More
      </Link>
      <PageHeader title="Repeat baskets" description="Baskets customers get delivered on a schedule, e.g. every Monday. Pause, resume or cancel one." />

      <div className="segmented growth-filters" role="group" aria-label="Show baskets">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            className={filter === f.id ? 'segmented__item is-selected' : 'segmented__item'}
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
          >
            {f.text}
          </button>
        ))}
      </div>

      {notice ? (
        <p className="quiet quiet--ok" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className={notReady ? 'banner' : 'field__error'} role="alert">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading repeat baskets" />
      ) : rows.length === 0 ? (
        error ? null : (
          <EmptyState
            title={filter === 'ALL' ? 'No repeat baskets yet' : `No ${REPEAT_STATUS_LABEL[filter].toLowerCase()} repeat baskets`}
            message="Customers set one up from an order or their cart in the Blynk app."
          />
        )
      ) : (
        <ul className="cat-list" aria-label="Repeat baskets">
          {rows.map((b) => (
            <BasketCard key={b.id} basket={b} busy={busyId === b.id} onChange={(to) => setPending({ basket: b, to })} />
          ))}
        </ul>
      )}

      {pending ? (
        <ConfirmDialog
          title={CONFIRM[pending.to].title}
          message={CONFIRM[pending.to].message(pending.basket)}
          confirmLabel={CONFIRM[pending.to].label}
          destructive={pending.to === 'CANCELLED'}
          onCancel={() => setPending(null)}
          onConfirm={() => void apply(pending)}
        />
      ) : null}
    </div>
  );
}

function BasketCard({ basket: b, busy, onChange }: { basket: StaffRepeatBasket; busy: boolean; onChange(to: RepeatStatus): void }) {
  const run = runText(b.last_run);
  const who = b.customer_name ?? b.customer_phone ?? 'Customer';
  return (
    <li className="card growth-card" aria-label={`${b.name} for ${who}`}>
      <div className="growth-card__head">
        <div>
          <p className="growth-card__title">{b.name}</p>
          <p className="growth-card__meta">
            {who}
            {b.customer_phone && b.customer_name ? (
              <>
                {' · '}
                <a className="link mono" href={`tel:${b.customer_phone}`}>
                  {b.customer_phone}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <Status tone={b.status === 'ACTIVE' ? 'ok' : b.status === 'PAUSED' ? 'warn' : 'muted'}>{REPEAT_STATUS_LABEL[b.status]}</Status>
      </div>
      <p className="growth-card__meta">
        {scheduleText(b)} · {b.items_count} {b.items_count === 1 ? 'item' : 'items'}
      </p>
      {b.status === 'ACTIVE' && b.next_run_at ? (
        <p className="growth-card__meta" data-testid="repeat-next">
          Next: {colomboWhen(b.next_run_at)}
          {b.skip_next ? ' (customer is skipping this one)' : ''}
        </p>
      ) : null}
      {run ? (
        <p className="growth-card__meta">
          Last: {b.last_run?.run_at ? `${colomboWhen(b.last_run.run_at)} · ` : ''}
          {b.last_run?.order_id ? (
            <Link className="link" to={`/orders/${b.last_run.order_id}`}>
              {run}
            </Link>
          ) : (
            run
          )}
        </p>
      ) : null}
      {b.status !== 'CANCELLED' ? (
        <div className="growth-card__actions">
          {b.status === 'ACTIVE' ? (
            <button type="button" className="button button--ghost" disabled={busy} onClick={() => onChange('PAUSED')} aria-label={`Pause ${b.name}`}>
              {busy ? 'Saving…' : 'Pause'}
            </button>
          ) : (
            <button type="button" className="button" disabled={busy} onClick={() => onChange('ACTIVE')} aria-label={`Resume ${b.name}`}>
              {busy ? 'Saving…' : 'Resume'}
            </button>
          )}
          <button
            type="button"
            className="button button--ink-outline"
            disabled={busy}
            onClick={() => onChange('CANCELLED')}
            aria-label={`Cancel ${b.name}`}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </li>
  );
}
