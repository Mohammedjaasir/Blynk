import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { products as productsApi, settings } from '../api/resources';
import type { AdminProduct } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import {
  closingTimeIso,
  clockText,
  endNowPayload,
  FLASH_DURATIONS,
  flashEndOf,
  flashEndsAt,
  flashPreview,
  flashSellingPrice,
  leftText,
  parseFlashPrice,
  startPayload,
  type FlashDurationId,
} from '../lib/flashDeal';
import { Field, Spinner } from './ui';
import './flashDeal.css';

/**
 * "Start flash deal" (wave 2, 2026-10-25): a price and how long it runs, set through the ordinary product
 * update (offer_price + offer_ends_at). Shows what customers will see, and "End now" while one is running.
 * The server still checks that the offer is below the selling price.
 */
export function FlashDealDialog({
  product,
  onClose,
  onDone,
}: {
  product: Pick<AdminProduct, 'id' | 'name' | 'calculated_selling_price' | 'selling_price' | 'offer_price' | 'offer_ends_at' | 'offer_active'>;
  onClose(): void;
  /** The product update went through (started or ended); `message` is what to tell the staff member. */
  onDone(message: string): void;
}) {
  const selling = flashSellingPrice(product);
  const runningEnd = flashEndOf(product);
  const hasOffer = product.offer_price != null && product.offer_active !== false;

  const [price, setPrice] = useState(runningEnd !== null && product.offer_price != null ? String(product.offer_price) : '');
  const [duration, setDuration] = useState<FlashDurationId>('2h');
  const [custom, setCustom] = useState('90');
  const [closing, setClosing] = useState<string | null | undefined>(undefined); // undefined = still loading
  const [busy, setBusy] = useState<'start' | 'end' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // closing time today, for "Until closing time" (the store schedule's today hours)
  useEffect(() => {
    let live = true;
    settings
      .getStoreSchedule()
      .then((s) => live && setClosing(closingTimeIso(s.status?.today_hours ?? null)))
      .catch(() => live && setClosing(null));
    return () => {
      live = false;
    };
  }, []);

  // the preview works from the form as it stands, against the clock when the dialog drew
  const preview = useMemo(() => {
    const parsed = parseFlashPrice(price, selling);
    const now = new Date();
    const end = flashEndsAt(duration, now, { closingIso: closing ?? null, customMinutes: custom });
    if ('error' in parsed || 'error' in end || selling === null) return null;
    return flashPreview(parsed.value, selling, end.iso, now);
  }, [price, selling, duration, closing, custom]);

  async function start(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const parsed = parseFlashPrice(price, selling);
    if ('error' in parsed) return setError(parsed.error);
    const now = new Date();
    const end = flashEndsAt(duration, now, { closingIso: closing ?? null, customMinutes: custom });
    if ('error' in end) return setError(end.error);
    setBusy('start');
    try {
      await productsApi.update(product.id, startPayload(parsed.value, end.iso));
      onDone(`Flash deal started on ${product.name}: LKR ${parsed.value.toFixed(2)} until ${clockText(end.iso)}.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not start the flash deal.'));
      setBusy(null);
    }
  }

  async function endNow() {
    setError(null);
    setBusy('end');
    try {
      await productsApi.update(product.id, endNowPayload());
      onDone(`The offer on ${product.name} has ended. Customers pay the selling price.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not end the offer.'));
      setBusy(null);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Start flash deal">
      <form className="modal__panel flash-dialog" onSubmit={start} noValidate>
        <h2 className="modal__title">{`Flash deal: ${product.name}`}</h2>
        <p className="modal__message">
          A short offer with a live countdown in the customer app. It ends by itself and the price goes back to normal.
          {selling !== null ? ` Selling price ${`LKR ${selling.toFixed(2)}`}.` : ''}
        </p>

        {runningEnd !== null ? (
          <p className="flash-dialog__running" role="status">
            {`Running now: LKR ${Number(product.offer_price).toFixed(2)}, ${leftText(runningEnd - Date.now())} left (ends ${clockText(new Date(runningEnd).toISOString())}). Starting again replaces it.`}
          </p>
        ) : hasOffer ? (
          <p className="flash-dialog__running" role="status">
            {`This product already has an offer (LKR ${Number(product.offer_price).toFixed(2)}). A flash deal replaces it.`}
          </p>
        ) : null}

        <Field label="Flash price (LKR)" hint="Customers pay this until the deal ends">
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>

        <div className="field">
          <span className="field__label" id="flash-length-label">
            How long
          </span>
          <div className="flash-dialog__chips" role="radiogroup" aria-labelledby="flash-length-label">
            {FLASH_DURATIONS.map((d) => {
              const disabled = d.id === 'closing' && closing === null;
              return (
                <button
                  key={d.id}
                  type="button"
                  role="radio"
                  aria-checked={duration === d.id}
                  disabled={disabled}
                  className={duration === d.id ? 'flash-chip is-selected' : 'flash-chip'}
                  onClick={() => setDuration(d.id)}
                  title={disabled ? 'No closing time left today' : undefined}
                >
                  {d.id === 'closing' && closing ? `Until closing (${clockText(closing)})` : d.label}
                </button>
              );
            })}
          </div>
          {duration === 'custom' ? (
            <input
              className="input flash-dialog__custom"
              inputMode="numeric"
              aria-label="Custom length in minutes"
              placeholder="Minutes (5 to 1440)"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          ) : null}
        </div>

        {preview ? (
          <div className="flash-preview" aria-label="What customers see">
            <span className="flash-preview__label">Customers see</span>
            <span className="flash-preview__row">
              <strong className="flash-preview__price">{preview.price}</strong>
              <s className="flash-preview__was">{preview.was}</s>
              <span className="flash-preview__off">{preview.percent}</span>
            </span>
            <span className="flash-preview__pill">{`⚡ ${preview.endsIn}`}</span>
            <span className="flash-preview__until">{preview.until}</span>
          </div>
        ) : null}

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy !== null}>
            Cancel
          </button>
          {hasOffer ? (
            <button type="button" className="button button--ghost button--danger-ghost" onClick={() => void endNow()} disabled={busy !== null}>
              {busy === 'end' ? <Spinner label="Ending" /> : 'End now'}
            </button>
          ) : null}
          <button type="submit" className="button" disabled={busy !== null}>
            {busy === 'start' ? <Spinner label="Starting" /> : 'Start flash deal'}
          </button>
        </div>
      </form>
    </div>
  );
}
