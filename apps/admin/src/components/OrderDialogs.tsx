import { useEffect, useId, useState } from 'react';
import { riders as ridersApi } from '../api/resources';
import type { BoardOrder, RiderSuggestions } from '../api/types';
import { formatMoney, orderErrorMessage, shortNumber, type OrderAction } from '../lib/orders';
import { Spinner } from './ui';
import { distanceText, fromRoster, loadText, riderName, tripText } from '../lib/riderSuggestions';

/**
 * Picks a rider for a packed order (manual dispatch, §H), best first
 * (GET /admin/riders/suggestions, backend rider trips 2026-09-30): least busy,
 * then nearest to the store by the rider's last GPS point ("about 1.2 km
 * away", or "location unknown" past 15 minutes). The best is marked
 * "Suggested" but never chosen for the operator. A rider already carrying an
 * order shows the trip it would join; a far one needs "Add to trip anyway";
 * a full trip cannot be picked. Without suggestions, the plain roster.
 */
export function AssignRiderDialog({
  order,
  busy,
  onAssign,
  onClose,
}: {
  order: BoardOrder;
  busy: boolean;
  onAssign(riderId: string, confirmFarBatch: boolean): void;
  onClose(): void;
}) {
  const titleId = useId();
  const [list, setList] = useState<{ data: RiderSuggestions; ranked: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    ridersApi
      .suggestions(order.id)
      .then((data) => !cancelled && setList({ data, ranked: true }))
      .catch(() =>
        ridersApi
          .listActive()
          .then((roster) => !cancelled && setList({ data: fromRoster(roster), ranked: false }))
          .catch((err) => !cancelled && setError(orderErrorMessage(err)))
      );
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const riders = list?.data.riders ?? null;
  const maxKm = list?.data.rules?.max_dropoff_distance_km ?? 0;
  const picked = riders?.find((r) => r.id === chosen) ?? null;
  const pickedTrip = picked ? tripText(picked, maxKm) : null;
  const label = busy ? 'Assigning…' : pickedTrip ? (pickedTrip.far ? 'Add to trip anyway' : 'Add to trip') : 'Assign';

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
            {riders.map((r) => {
              const trip = tripText(r, maxKm);
              return (
                <label
                  key={r.id}
                  className={`rider-pick__option${chosen === r.id ? ' rider-pick__option--on' : ''}${r.at_capacity ? ' rider-pick__option--off' : ''}`}
                >
                  <input
                    type="radio"
                    name="rider"
                    value={r.id}
                    checked={chosen === r.id}
                    disabled={r.at_capacity}
                    onChange={() => setChosen(r.id)}
                  />
                  <span className="rider-pick__name">
                    {riderName(r)}
                    {r.suggested ? <span className="rider-pick__badge">Suggested</span> : null}
                  </span>
                  <span className="rider-pick__meta">
                    <span className="mono">{r.vehicle_registration_number}</span> · {loadText(r.open_deliveries)}
                    {list?.ranked ? ` · ${distanceText(r)}` : null}
                  </span>
                  {r.at_capacity ? (
                    <span className="rider-pick__trip">Trip full ({r.open_deliveries} orders)</span>
                  ) : trip ? (
                    <span className={`rider-pick__trip${trip.far ? ' rider-pick__trip--far' : ''}`}>{trip.text}</span>
                  ) : null}
                </label>
              );
            })}
          </fieldset>
        ) : null}

        {pickedTrip?.far ? (
          <p className="ops-notice" role="status">
            These drop-offs are far apart. The rider will take longer to reach both customers.
          </p>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Back
          </button>
          <button
            type="button"
            className="button"
            disabled={!picked || picked.at_capacity || busy}
            onClick={() => picked && onAssign(picked.id, pickedTrip?.far ?? false)}
          >
            {label}
          </button>
        </div>
      </div>
    </div>
  );
}

type NoteAction = Extract<OrderAction, 'cancel' | 'markFailed' | 'markCustomerUnavailable' | 'restage'>;

const NOTE_COPY: Record<NoteAction, { title: string; field: string; confirm: string; message(o: BoardOrder): string }> = {
  cancel: {
    title: 'Cancel order',
    field: 'Reason — shown to the customer',
    confirm: 'Cancel order',
    message: () => 'The customer is told the order is cancelled, with this reason. This cannot be undone.',
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

/**
 * Mark delivered (admin). Proof first: the customer's 4-digit delivery code.
 * Only when there is no code does the admin write an override note, so the
 * history says truthfully which one it was ("customer code confirmed" or
 * "without the customer code (override)").
 */
export function MarkDeliveredDialog({
  order,
  busy,
  onConfirm,
  onClose,
}: {
  order: BoardOrder;
  busy: boolean;
  onConfirm(proof: { deliveryCode: string } | { notes: string }): void;
  onClose(): void;
}) {
  const titleId = useId();
  const codeId = useId();
  const noteId = useId();
  const [code, setCode] = useState('');
  const [notes, setNotes] = useState('');
  const hasCode = code.length > 0;
  const codeComplete = /^[0-9]{4}$/.test(code);
  const trimmed = notes.trim();
  const canSubmit = !busy && (hasCode ? codeComplete : trimmed.length > 0);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        className="modal__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onConfirm(hasCode ? { deliveryCode: code } : { notes: trimmed });
        }}
      >
        <h2 className="modal__title" id={titleId}>
          Mark delivered #{shortNumber(order.order_number)}
        </h2>
        <p className="modal__message">
          Records {formatMoney(order.total_amount)} cash as collected and completes the delivery.
        </p>
        <label className="field" htmlFor={codeId}>
          <span className="field__label">Customer's delivery code</span>
          <input
            id={codeId}
            className="input mono"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            autoFocus
          />
          {hasCode && !codeComplete ? (
            <span className="field__error">The code has 4 digits.</span>
          ) : (
            <span className="field__hint">The 4 digits the customer sees in the app.</span>
          )}
        </label>
        <label className="field" htmlFor={noteId}>
          <span className="field__label">Note (only without a code)</span>
          <textarea
            id={noteId}
            className="input"
            rows={3}
            maxLength={1000}
            value={notes}
            disabled={hasCode}
            onChange={(event) => setNotes(event.target.value)}
          />
          <span className="field__hint">
            {hasCode
              ? 'Not needed: the code confirms the delivery.'
              : 'No code? Say why - it is recorded as delivered without the customer code.'}
          </span>
        </label>
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Back
          </button>
          <button type="submit" className="button button--ink" disabled={!canSubmit}>
            {busy ? 'Saving…' : 'Mark delivered'}
          </button>
        </div>
      </form>
    </div>
  );
}

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
