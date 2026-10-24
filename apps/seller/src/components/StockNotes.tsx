import { useState } from 'react';
import { sellerApi } from '../api/resources';
import type { StockNote } from '../api/types';
import { formatDate, formatNumber } from '../lib/format';
import { noteChip, requestMessage, whenWords } from '../lib/requests';

/** The calendar tile on a note: "27 / Oct". */
function DayTile({ day, tone }: { day: string; tone: string }) {
  const date = new Date(`${day}T00:00:00+05:30`);
  const valid = !Number.isNaN(date.getTime());
  const d = valid ? date.toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Asia/Colombo' }) : '';
  const m = valid ? date.toLocaleDateString('en-GB', { month: 'short', timeZone: 'Asia/Colombo' }) : '';
  return (
    <span className={`dtile dtile--${tone}`} aria-hidden="true">
      <span className="dtile__m">{m}</span>
      <span className="dtile__d">{d}</span>
    </span>
  );
}

/** Stock notes with their status: On its way (can be cancelled) / Received N / Cancelled. */
export function StockNoteList({
  notes,
  onChanged,
  onError,
}: {
  notes: StockNote[];
  onChanged(message: string): Promise<void> | void;
  onError(message: string): void;
}) {
  return (
    <ul className="snotes">
      {notes.map((note, index) => (
        <li key={note.id} className="rise" style={{ ['--i' as string]: Math.min(index, 6) }}>
          <StockNoteRow note={note} onChanged={onChanged} onError={onError} />
        </li>
      ))}
    </ul>
  );
}

function StockNoteRow({
  note,
  onChanged,
  onError,
}: {
  note: StockNote;
  onChanged(message: string): Promise<void> | void;
  onError(message: string): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const chip = noteChip(note);

  async function cancel() {
    setBusy(true);
    try {
      await sellerApi.cancelStockNote(note.id);
      await onChanged(`Cancelled: ${formatNumber(note.quantity)} × ${note.product_name}.`);
    } catch (err) {
      onError(requestMessage(err, 'Could not cancel the note. Please try again.'));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <article className={`snote snote--${chip.tone}`} aria-label={`${note.product_name}, ${chip.label}`}>
      <DayTile day={note.expected_on} tone={chip.tone} />
      <div className="snote__body">
        <div className="snote__row">
          <h3 className="snote__name">{note.product_name}</h3>
          <span className={`chip chip--${chip.tone}`}>
            <span className="chip__dot" aria-hidden="true" />
            {chip.label}
          </span>
        </div>
        <p className="snote__meta">
          <strong>{formatNumber(note.quantity)}</strong> {note.quantity === 1 ? 'unit' : 'units'} ·{' '}
          {note.status === 'RECEIVED' && note.received_at
            ? `arrived ${formatDate(note.received_at)}`
            : note.status === 'CANCELLED'
              ? `was for ${formatDate(note.expected_on)}`
              : `coming ${whenWords(note.expected_on)}`}
        </p>
        {note.note ? <p className="snote__note">“{note.note}”</p> : null}
        {note.status === 'SENT' ? (
          <div className="snote__actions">
            {confirming ? (
              <span className="confirm">
                <button type="button" className="button button--danger button--small" disabled={busy} onClick={() => void cancel()}>
                  Yes, cancel it
                </button>
                <button type="button" className="button button--link" disabled={busy} onClick={() => setConfirming(false)}>
                  Keep it
                </button>
              </span>
            ) : (
              <button type="button" className="button button--link" onClick={() => setConfirming(true)}>
                Cancel this note
              </button>
            )}
          </div>
        ) : null}
      </div>
    </article>
  );
}
