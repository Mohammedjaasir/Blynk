import { useRef, useState, type FormEvent } from 'react';
import { sourcingApi } from '../api/resources';
import type { QueueOrder, SourcingItem, StockRow, Supplier } from '../api/types';
import { Dialog, Field, Spinner } from '../components/ui';
import { errorMessage, isApiError } from '../lib/errors';
import { formatMoney } from '../lib/format';

/**
 * Records what an item actually cost to source. The actual unit cost is kept
 * on the order line next to the estimate; the customer's price, the markup
 * and the catalog cost are not touched (backend invariant, restated here so
 * the operator knows).
 *
 * Suppliers come only from the active list (D2) - the payload never carries
 * a free-text supplier name.
 */
export function SourceItemDialog({
  order,
  item,
  stock,
  suppliers,
  onClose,
  onSourced,
  onAlreadySourced,
  onMarkUnavailable,
}: {
  order: QueueOrder;
  item: SourcingItem;
  stock?: StockRow;
  suppliers: Supplier[];
  onClose(): void;
  onSourced(message: string): void;
  onAlreadySourced(): void;
  onMarkUnavailable(): void;
}) {
  const [cost, setCost] = useState('');
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [supplierId, setSupplierId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outOfStock, setOutOfStock] = useState(false);
  const submitting = useRef(false);

  const tracked = stock?.tracking_mode === 'TRACKED';
  const costValue = /^\d+(\.\d{1,2})?$/.test(cost.trim()) ? Number(cost.trim()) : null;
  const qtyValue = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : null;
  const variance = costValue === null ? null : costValue - item.estimated_unit_cost;

  function validate(): string | null {
    if (cost.trim() === '') return 'Enter the actual unit cost you paid.';
    if (costValue === null) return 'Enter the cost in rupees, with at most two decimals (e.g. 455.50).';
    if (qtyValue === null || qtyValue < 1 || qtyValue > item.quantity) {
      return `Quantity must be a whole number from 1 to ${item.quantity}.`;
    }
    if (tracked && stock && qtyValue > stock.quantity_on_hand) {
      return `Only ${stock.quantity_on_hand} counted in stock. Restock first, or mark the item unavailable.`;
    }
    if (notes.length > 500) return 'Keep the note under 500 characters.';
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    setOutOfStock(false);
    try {
      await sourcingApi.source(order.id, item.id, {
        actual_unit_cost: costValue!,
        quantity: qtyValue!,
        ...(supplierId ? { supplier_id: supplierId } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onSourced(`${item.product_name_snapshot} sourced at ${formatMoney(costValue!)} per unit.`);
    } catch (err) {
      if (isApiError(err, 'ITEM_ALREADY_SOURCED')) {
        onAlreadySourced();
        return;
      }
      if (isApiError(err, 'INSUFFICIENT_TRACKED_INVENTORY')) setOutOfStock(true);
      setError(errorMessage(err, 'The item was not sourced.'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Source · ${item.product_name_snapshot}`} onClose={onClose} wide>
      <form onSubmit={submit} className="form" noValidate>
        <dl className="facts">
          <div>
            <dt>Order</dt>
            <dd className="mono">{order.order_number}</dd>
          </div>
          <div>
            <dt>Ordered</dt>
            <dd className="mono">
              {item.quantity} × {item.unit_snapshot}
            </dd>
          </div>
          <div>
            <dt>Estimate</dt>
            <dd className="mono">{formatMoney(item.estimated_unit_cost)} / unit</dd>
          </div>
          <div>
            <dt>Stock</dt>
            <dd>{tracked && stock ? <span className="mono">{stock.quantity_on_hand} counted</span> : 'Sourced on order'}</dd>
          </div>
        </dl>

        <div className="form__row">
          <Field label="Actual unit cost (Rs.)" hint="What you paid per unit.">
            <input
              className="input input--mono"
              inputMode="decimal"
              value={cost}
              onChange={(e) => {
                setCost(e.target.value);
                setError(null);
              }}
              data-autofocus
            />
          </Field>
          <Field label="Quantity sourced" hint={`1 to ${item.quantity}`}>
            <input
              className="input input--mono"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => {
                setQuantity(e.target.value);
                setError(null);
              }}
            />
          </Field>
        </div>

        {variance !== null ? (
          <p className="preview mono" aria-live="polite">
            {formatMoney(costValue!)} vs estimate {formatMoney(item.estimated_unit_cost)} ·{' '}
            <span className={variance > 0 ? 'delta--down' : variance < 0 ? 'delta--up' : ''}>
              {variance === 0 ? 'on estimate' : `${variance > 0 ? '+' : '−'}${formatMoney(Math.abs(variance))}`}
            </span>
          </p>
        ) : null}

        <Field label="Supplier" hint="Active suppliers only. A new supplier is added on the Suppliers screen by an admin.">
          <select className="input" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Not recorded</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.code ? ` (${s.code})` : ''}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Note (optional)">
          <input className="input" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <p className="form__lead">
          Recording the actual cost does not change the customer’s price, the markup or the catalog cost.
          {tracked ? ' Sourcing a tracked product takes the quantity from counted stock.' : ''}
        </p>

        {error ? (
          <div className="notice notice--bad" role="alert">
            <span>{error}</span>
            {outOfStock ? (
              <button type="button" className="button button--ghost button--sm" onClick={onMarkUnavailable}>
                Mark unavailable
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? <Spinner label="Recording" /> : 'Record sourcing'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
