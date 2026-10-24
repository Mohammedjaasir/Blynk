import { useState, type FormEvent } from 'react';
import { sellerApi } from '../api/resources';
import type { SellerProduct } from '../api/types';
import { fieldErrors } from '../lib/apiErrors';
import { formatNumber, todayColombo } from '../lib/format';
import { addDays, isRequestsNotReady, requestMessage, whenWords } from '../lib/requests';
import { IconMinus, IconPlus, IconTruck } from './icons';
import { Illustration } from './Illustration';
import { Sheet } from './Sheet';
import { ButtonArrow, Field, Spinner, describedBy } from './ui';

export const QTY_MAX = 10000;
const NOTE_MAX = 500;

type Errors = Partial<Record<'product_id' | 'quantity' | 'expected_on' | 'note', string>>;

/**
 * "Send stock to Blynk": the seller says how many of a product they are
 * bringing to the Blynk store, and on which day. Blynk ticks it off when the
 * goods arrive (POST /seller/stock-notes).
 */
export function StockNoteSheet({
  products,
  productId,
  onClose,
  onSent,
  onNotReady,
}: {
  /** The products a note can be for (live products of this shop). */
  products: SellerProduct[];
  /** Opened from a product card: that product, fixed. */
  productId?: string;
  onClose(): void;
  onSent(message: string): void;
  /** The server is not ready for notes yet: the screen hides the feature. */
  onNotReady?(): void;
}) {
  const today = todayColombo();
  const fixed = productId ? products.find((p) => p.id === productId) ?? null : null;
  const [chosen, setChosen] = useState(productId ?? (products.length === 1 ? products[0]!.id : ''));
  const [quantity, setQuantity] = useState('');
  const [day, setDay] = useState(addDays(today, 1));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const product = products.find((p) => p.id === chosen) ?? null;
  const qty = Number(quantity);

  function step(by: number) {
    const now = Number.isInteger(qty) && qty > 0 ? qty : 0;
    setQuantity(String(Math.min(QTY_MAX, Math.max(1, now + by))));
  }

  function check(): Errors {
    const found: Errors = {};
    if (!chosen) found.product_id = 'Choose the product you are bringing.';
    if (!/^\d+$/.test(quantity.trim()) || qty < 1) found.quantity = 'Enter how many you are bringing (1 or more).';
    else if (qty > QTY_MAX) found.quantity = `That is a lot - ${formatNumber(QTY_MAX)} at most in one note.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) found.expected_on = 'Choose the day you will bring it.';
    else if (day < today) found.expected_on = 'Choose today or a day after today.';
    if (note.trim().length > NOTE_MAX) found.note = `The note is too long (${NOTE_MAX} letters at most).`;
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found = check();
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await sellerApi.sendStockNote({
        product_id: chosen,
        quantity: qty,
        expected_on: day,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onSent(`Sent. Blynk knows ${formatNumber(qty)} × ${product?.name ?? 'your product'} is coming ${whenWords(day, today)}.`);
    } catch (err) {
      const server = fieldErrors(err);
      const mapped: Errors = {};
      for (const key of ['product_id', 'quantity', 'expected_on', 'note'] as const) {
        if (server[key]) mapped[key] = server[key];
      }
      setErrors(mapped);
      setFormError(
        Object.keys(mapped).length > 0
          ? 'Please fix the highlighted boxes.'
          : requestMessage(err, 'Could not send the note. Please try again.')
      );
      if (isRequestsNotReady(err)) onNotReady?.();
      setBusy(false);
    }
  }

  const quick = [
    { label: 'Today', value: today },
    { label: 'Tomorrow', value: addDays(today, 1) },
    { label: 'In 2 days', value: addDays(today, 2) },
  ];

  return (
    <Sheet
      eyebrow="Send stock to Blynk"
      title={fixed ? `Bring more ${fixed.name}` : 'Bring stock to the Blynk store'}
      lede="Tell Blynk what you are bringing and when. They will check it off when it arrives."
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={submit} noValidate className="stockform">
        {fixed ? (
          <div className="stockform__product">
            {fixed.image_url ? (
              <img src={fixed.image_url} alt="" className="stockform__thumb" />
            ) : (
              <span className="stockform__thumb stockform__thumb--none" aria-hidden="true">
                <Illustration name="jar" />
              </span>
            )}
            <span className="stockform__product-text">
              <strong>{fixed.name}</strong>
              <span className="muted">
                {fixed.stock_on_hand === null
                  ? 'Blynk does not count stock for this one'
                  : `${formatNumber(fixed.stock_on_hand)} at Blynk now`}
              </span>
            </span>
          </div>
        ) : (
          <Field id="sn-product" label="Product" required error={errors.product_id}>
            <select
              id="sn-product"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
              aria-invalid={Boolean(errors.product_id)}
              aria-describedby={describedBy('sn-product', false, errors.product_id)}
            >
              <option value="">Choose a product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.pack_size || p.unit ? ` (${p.pack_size ?? p.unit})` : ''}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field id="sn-qty" label="How many?" required hideOptional error={errors.quantity}>
          <div className="stepper">
            <button type="button" className="stepper__btn" aria-label="One less" onClick={() => step(-1)} disabled={busy}>
              <IconMinus size={20} />
            </button>
            <input
              id="sn-qty"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              className="stepper__input"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/\D/g, '').slice(0, 5))}
              aria-invalid={Boolean(errors.quantity)}
              aria-describedby={describedBy('sn-qty', false, errors.quantity)}
            />
            <button type="button" className="stepper__btn" aria-label="One more" onClick={() => step(1)} disabled={busy}>
              <IconPlus size={20} />
            </button>
          </div>
        </Field>

        <Field id="sn-day" label="When will you bring it?" required hideOptional error={errors.expected_on}>
          <div className="daypick" role="group" aria-label="Quick days">
            {quick.map((q) => (
              <button
                key={q.label}
                type="button"
                className={`pill daypick__pill${day === q.value ? ' is-on' : ''}`}
                aria-pressed={day === q.value}
                onClick={() => setDay(q.value)}
              >
                {q.label}
              </button>
            ))}
          </div>
          <input
            id="sn-day"
            type="date"
            min={today}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-invalid={Boolean(errors.expected_on)}
            aria-describedby={describedBy('sn-day', false, errors.expected_on)}
          />
        </Field>

        <Field id="sn-note" label="Note for Blynk" error={errors.note} hint="For example: new batch, best before March.">
          <textarea
            id="sn-note"
            rows={2}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            aria-invalid={Boolean(errors.note)}
            aria-describedby={describedBy('sn-note', true, errors.note)}
          />
        </Field>

        {formError ? (
          <p className="notice notice--bad" role="alert">
            {formError}
          </p>
        ) : null}

        <button type="submit" className="button button--primary button--block button--cta" disabled={busy}>
          {busy ? <Spinner label="Sending" /> : <IconTruck size={20} />} Send to Blynk
          <ButtonArrow />
        </button>
      </form>
    </Sheet>
  );
}
