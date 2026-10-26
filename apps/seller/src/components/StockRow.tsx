import { useState, type FormEvent } from 'react';
import { sellerApi } from '../api/resources';
import type { SellerProduct } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { formatNumber } from '../lib/format';
import { STOCK_MAX, digitsOnly, isTracked, parseStock, stepStock, stockBadge } from '../lib/stock';
import { IconCheckCircle, IconMinus, IconPlus } from './icons';
import { Illustration } from './Illustration';

export const STOCK_RANGE_MESSAGE = `Enter a whole number from 0 to ${formatNumber(STOCK_MAX)}.`;

/**
 * One product on My stock: the number Blynk shows customers, a box to type the real number
 * (with - / + steppers) and Save (PUT /seller/products/:id/stock). The number the server
 * answers becomes the new on-hand; its friendly refusal (below what open orders reserved, not
 * counted by Blynk, sizes) is shown under the box.
 */
export function StockRow({ product, editable }: { product: SellerProduct; editable: boolean }) {
  const tracked = isTracked(product);
  const [onHand, setOnHand] = useState<number | null>(product.stock_on_hand);
  const [reserved, setReserved] = useState<number | null>(product.stock_reserved ?? null);
  const [text, setText] = useState(product.stock_on_hand === null ? '' : String(product.stock_on_hand));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const parsed = parseStock(text);
  const outOfRange = text !== '' && parsed === null;
  const changed = parsed !== null && parsed !== onHand;
  const badge = stockBadge(onHand);
  const inputId = `stock-${product.id}`;
  const errorId = `${inputId}-error`;

  function edit(next: string) {
    setText(next);
    setSaved(null);
    setError(null);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy || !editable || !tracked) return;
    if (parsed === null) {
      setError(STOCK_RANGE_MESSAGE);
      return;
    }
    if (!changed) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const result = await sellerApi.setStock(product.id, parsed);
      setOnHand(result.stock_on_hand);
      setReserved(result.stock_reserved ?? null);
      setText(String(result.stock_on_hand));
      setSaved(`Saved. ${formatNumber(result.stock_on_hand)} in stock.`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save your stock. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="sedit" aria-label={product.name}>
      {product.image_url ? (
        <img className="sedit__thumb" src={product.image_url} alt="" loading="lazy" />
      ) : (
        <span className="sedit__thumb sedit__thumb--none" aria-hidden="true">
          <Illustration name="jar" />
        </span>
      )}

      <div className="sedit__main">
        <div className="sedit__top">
          <span className="sedit__name">{product.name}</span>
          {badge ? (
            <span className={`chip chip--${badge.tone} chip--small`}>
              <span className="chip__dot" aria-hidden="true" />
              {badge.label}
            </span>
          ) : null}
        </div>
        <p className="muted sedit__meta">
          {[product.pack_size ?? product.unit, !product.is_active ? 'Switched off' : null].filter(Boolean).join(' · ')}
        </p>
        {tracked && reserved ? (
          <p className="muted sedit__meta">
            {formatNumber(reserved)} reserved for open orders, so the stock cannot go below that.
          </p>
        ) : null}
      </div>

      {tracked ? (
        <form className="sedit__form" onSubmit={save} noValidate>
          <div className="sedit__count" aria-live="polite">
            <strong data-testid={`on-hand-${product.id}`}>{onHand === null ? '-' : formatNumber(onHand)}</strong>
            <small>{onHand === null ? 'not set yet' : 'in stock'}</small>
          </div>
          <div className="sedit__stepper">
            <button
              type="button"
              className="stepper__btn sedit__btn"
              aria-label={`One less ${product.name}`}
              disabled={!editable || busy}
              onClick={() => edit(stepStock(text, -1))}
            >
              <IconMinus size={18} />
            </button>
            <input
              id={inputId}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="0"
              className="stepper__input sedit__input"
              aria-label={`Stock of ${product.name}`}
              aria-invalid={Boolean(error) || outOfRange}
              aria-describedby={error || outOfRange ? errorId : undefined}
              value={text}
              disabled={!editable || busy}
              onChange={(e) => edit(digitsOnly(e.target.value))}
            />
            <button
              type="button"
              className="stepper__btn sedit__btn"
              aria-label={`One more ${product.name}`}
              disabled={!editable || busy}
              onClick={() => edit(stepStock(text, 1))}
            >
              <IconPlus size={18} />
            </button>
          </div>
          <button
            type="submit"
            className="button button--primary button--small sedit__save"
            aria-label={`Save stock of ${product.name}`}
            disabled={!editable || busy || !changed}
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </form>
      ) : (
        <p className="muted sedit__untracked">
          Blynk does not count this product&apos;s stock. Ask Blynk if you want to manage it here.
        </p>
      )}

      {error || outOfRange ? (
        <p className="field__error sedit__msg" id={errorId} role="alert">
          {error ?? STOCK_RANGE_MESSAGE}
        </p>
      ) : saved ? (
        <p className="sedit__msg sedit__saved" role="status">
          <IconCheckCircle size={16} /> {saved}
        </p>
      ) : null}
    </li>
  );
}
