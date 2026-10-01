import { useEffect, useId, useRef, useState } from 'react';
import { riders as ridersApi } from '../api/resources';
import type { RiderSuggestions } from '../api/types';
import { formatMoney, orderErrorMessage, shortNumber, type OrderAction } from '../lib/orders';
import { DeliveryCodeField, isCompleteDeliveryCode } from './DeliveryCodeField';
import { distanceText, fromRoster, loadText, riderName, tripText } from '../lib/riderSuggestions';

/**
 * Assign-rider and note-required dialogs for the Orders board/detail (task
 * F3). Ported from apps/admin/src/components/OrderDialogs.tsx (a fresh
 * implementation, not an import - common.md rule 2); the Operations operator
 * is always ADMIN, so there is no role prop to thread through, unlike
 * Admin's version.
 *
 * Both dialogs read only the four order fields below - deliberately not
 * typed as the full `BoardOrder`, since the board (a `BoardOrder` row) and
 * the standalone detail page (an `OrderDetail`, a differently-shaped
 * response - see `api/types.ts`) both open these same dialogs, and both
 * shapes are structural supersets of this. The caller (not the dialog)
 * always owns the real order id for the actual API call.
 */
interface OrderSummary {
  order_number: string;
  delivery_address_line1: string;
  delivery_city: string;
  total_amount: number;
}

/**
 * Picks a rider for a packed order (manual dispatch), best first
 * (`GET /admin/riders/suggestions`, backend rider trips 2026-09-30): the
 * least busy rider, then the nearest to the store by their last GPS point
 * ("about 1.2 km away", or "location unknown" when it is over 15 minutes
 * old). The best one is marked "Suggested"; nothing is chosen for the
 * operator. A rider who already carries an order shows the trip it would
 * join and how far apart the two drop-offs are; a far one needs a
 * deliberate "Add to trip anyway". A full trip cannot be picked. If the
 * suggestions cannot be loaded, the plain roster (`GET /admin/riders`) is
 * offered instead so dispatch never stops.
 */
export function AssignRiderDialog({
  order,
  busy,
  onAssign,
  onClose,
}: {
  order: OrderSummary & { id: string };
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

        {error ? (
          <p className="field__error" role="status">
            {error}
          </p>
        ) : null}
        {!riders && !error ? (
          <p className="loading" role="status">
            Loading riders…
          </p>
        ) : null}
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
          <p className="field__error" role="status">
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

const NOTE_COPY: Record<NoteAction, { title: string; field: string; confirm: string; message(o: OrderSummary): string }> = {
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

/** A deliberate step that needs a note (the API refuses it without one). */
export function NoteDialog({
  action,
  order,
  busy,
  onConfirm,
  onClose,
}: {
  action: NoteAction;
  order: OrderSummary;
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

export type DeliveryProof = { deliveryCode: string } | { overrideNote: string };

/**
 * "Mark delivered" with proof of delivery (backend migration 016). Normally
 * the customer's 4-digit code; when the customer cannot show it, a written
 * override note instead. The API records which one was used. A refused code
 * (`error`) is shown under the field and the dialog stays open.
 */
export function MarkDeliveredDialog({
  order,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  order: OrderSummary;
  busy: boolean;
  error: { message: string; locked: boolean } | null;
  onConfirm(proof: DeliveryProof): void;
  onClose(): void;
}) {
  const titleId = useId();
  const noteId = useId();
  const [mode, setMode] = useState<'code' | 'override'>('code');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const codeRef = useRef<HTMLInputElement>(null);
  const locked = error?.locked ?? false;
  const trimmed = note.trim();
  const ready = !busy && (mode === 'code' ? isCompleteDeliveryCode(code) && !locked : trimmed.length > 0);

  // A refused code is cleared so the next try starts empty.
  useEffect(() => {
    if (error) {
      setCode('');
      if (!error.locked) codeRef.current?.focus();
    }
  }, [error]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <form
        className="modal__panel"
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready) return;
          onConfirm(mode === 'code' ? { deliveryCode: code } : { overrideNote: trimmed });
        }}
      >
        <h2 className="modal__title" id={titleId}>
          Mark delivered #{shortNumber(order.order_number)}
        </h2>
        <p className="modal__message">Records {formatMoney(order.total_amount)} cash as collected and completes the delivery.</p>
        {mode === 'code' ? (
          <>
            <DeliveryCodeField
              ref={codeRef}
              value={code}
              onChange={setCode}
              error={error?.message}
              disabled={locked}
              autoFocus
            />
            <button type="button" className="link" onClick={() => setMode('override')}>
              The customer can't show the code
            </button>
          </>
        ) : (
          <>
            <label className="field" htmlFor={noteId}>
              <span className="field__label">Override note — why there is no code</span>
              <textarea
                id={noteId}
                className="input"
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                autoFocus
              />
              <span className="field__hint">Recorded as delivered without the customer's code.</span>
            </label>
            <button type="button" className="link" onClick={() => setMode('code')}>
              Enter the customer's code instead
            </button>
          </>
        )}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Back
          </button>
          <button type="submit" className="button button--ink" disabled={!ready}>
            {busy ? 'Saving…' : 'Mark delivered'}
          </button>
        </div>
      </form>
    </div>
  );
}
