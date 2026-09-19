import { useEffect, useId, useState } from 'react';
import { riders as ridersApi } from '../api/resources';
import type { BoardOrder, RiderOption } from '../api/types';
import { formatMoney, orderErrorMessage, shortNumber, type OrderAction } from '../lib/orders';
import { Spinner } from './ui';

/** Picks one of the active riders the API lists (manual dispatch, §H). */
export function AssignRiderDialog({
  order,
  busy,
  onAssign,
  onClose,
}: {
  order: BoardOrder;
  busy: boolean;
  onAssign(riderId: string): void;
  onClose(): void;
}) {
  const titleId = useId();
  const [riders, setRiders] = useState<RiderOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ridersApi
      .listActive()
      .then((list) => !cancelled && setRiders(list))
      .catch((err) => !cancelled && setError(orderErrorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="modal__panel">
        <h2 className="modal__title" id={titleId}>
          Assign a rider to #{shortNumber(order.order_number)}
        </h2>
        <p className="modal__message">
          {order.delivery_address_line1}, {order.delivery_city} · {formatMoney(order.total_amount)} cash on delivery
        </p>

        {error ? <p className="ops-notice" role="status">{error}</p> : null}
        {!riders && !error ? <Spinner label="Loading riders" /> : null}
        {riders && riders.length === 0 ? <p className="modal__message">No active riders. Activate a rider first.</p> : null}

        {riders && riders.length > 0 ? (
          <fieldset className="rider-pick">
            <legend className="visually-hidden">Active riders</legend>
            {riders.map((r) => (
              <label key={r.id} className={`rider-pick__option${chosen === r.id ? ' rider-pick__option--on' : ''}`}>
                <input type="radio" name="rider" value={r.id} checked={chosen === r.id} onChange={() => setChosen(r.id)} />
                <span className="rider-pick__name">{r.full_name ?? r.phone}</span>
                <span className="rider-pick__meta">
                  <span className="mono">{r.vehicle_registration_number}</span> ·{' '}
                  {r.open_deliveries === 0
                    ? 'No open deliveries'
                    : `${r.open_deliveries} open ${r.open_deliveries === 1 ? 'delivery' : 'deliveries'}`}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Back
          </button>
          <button type="button" className="button" disabled={!chosen || busy} onClick={() => chosen && onAssign(chosen)}>
            {busy ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  );
}

type NoteAction = Extract<OrderAction, 'cancel' | 'markDelivered' | 'markFailed' | 'markCustomerUnavailable' | 'restage'>;

const NOTE_COPY: Record<NoteAction, { title: string; field: string; confirm: string; message(o: BoardOrder): string }> = {
  cancel: {
    title: 'Cancel order',
    field: 'Reason — shown to the customer',
    confirm: 'Cancel order',
    message: () => 'The customer is told the order is cancelled, with this reason. This cannot be undone.',
  },
  markDelivered: {
    title: 'Mark delivered',
    field: 'Note',
    confirm: 'Mark delivered',
    message: (o) => `Records ${formatMoney(o.total_amount)} cash as collected and completes the delivery.`,
  },
  markFailed: {
    title: 'Mark failed',
    field: 'Note',
    confirm: 'Mark failed',
    message: () => 'Ends this delivery attempt. You can then return the order to packed for a new rider.',
  },
  markCustomerUnavailable: {
    title: 'Customer unavailable',
    field: 'Note',
    confirm: 'Customer unavailable',
    message: () => 'Ends this delivery attempt. You can then return the order to packed for a new rider.',
  },
  restage: {
    title: 'Return to packed',
    field: 'Note',
    confirm: 'Return to packed',
    message: () => 'The bag is back at the store; the order goes back to Ready for a rider.',
  },
};

export const needsNote = (action: OrderAction): action is NoteAction => action in NOTE_COPY;

/** A deliberate step that needs a staff note (the API refuses it without one). */
export function NoteDialog({
  action,
  order,
  busy,
  onConfirm,
  onClose,
}: {
  action: NoteAction;
  order: BoardOrder;
  busy: boolean;
  onConfirm(notes: string): void;
  onClose(): void;
}) {
  const titleId = useId();
  const fieldId = useId();
  const [notes, setNotes] = useState('');
  const copy = NOTE_COPY[action];
  const trimmed = notes.trim();

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        className="modal__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (trimmed && !busy) onConfirm(trimmed);
        }}
      >
        <h2 className="modal__title" id={titleId}>
          {copy.title} #{shortNumber(order.order_number)}
        </h2>
        <p className="modal__message">{copy.message(order)}</p>
        <label className="field" htmlFor={fieldId}>
          <span className="field__label">{copy.field}</span>
          <textarea
            id={fieldId}
            className="input"
            rows={3}
            maxLength={1000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            autoFocus
          />
        </label>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Back
          </button>
          <button type="submit" className={action === 'restage' ? 'button' : 'button button--ink'} disabled={!trimmed || busy}>
            {busy ? 'Saving…' : copy.confirm}
          </button>
        </div>
      </form>
    </div>
  );
}
