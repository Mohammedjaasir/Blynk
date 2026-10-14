import { useRef, useState, type FormEvent } from 'react';
import { inventory as inventoryApi } from '../../api/resources';
import type { ManualAdjustmentType, StockDetail } from '../../api/types';
import { Field, Spinner } from '../../components/ui';
import { ADJUSTMENT_LABEL, formatDelta, inventoryErrorMessage } from '../../lib/inventory';

/**
 * Manual stock adjustment (task F6, ADMIN, tracked products only). Ported
 * from `apps/inventory/src/pages/AdjustDialog.tsx` (a fresh implementation,
 * not an import - common.md rule 2), as a hand-rolled `.modal`/`.form`
 * dialog matching Operations' own established dialog convention.
 *
 * The rules mirror the backend's manual-adjustment contract - a restock
 * adds, a write-off removes, an audit correction sets the counted figure in
 * either direction - but the backend enforces them regardless of what this
 * form allows; the resulting on-hand figure shown after submit always comes
 * from the API's own response, never predicted here beyond the one preview
 * line (common.md's "never duplicate stock-integrity calculations
 * client-side" rule).
 */
const TYPES: Array<{ id: ManualAdjustmentType; hint: string; quantityLabel: string }> = [
  { id: 'PURCHASE_RESTOCK', hint: 'Stock received. Adds units.', quantityLabel: 'Units received' },
  { id: 'DAMAGE_WRITE_OFF', hint: 'Damaged, expired or lost. Removes units.', quantityLabel: 'Units written off' },
  {
    id: 'INVENTORY_AUDIT_ADJUSTMENT',
    hint: 'A physical count. Sets on-hand to what you counted.',
    quantityLabel: 'Counted on hand',
  },
];

export function AdjustDialog({
  detail,
  variantId,
  onClose,
  onDone,
}: {
  /** The stock row being adjusted; `product_name` is the display name ("Chilli Powder - 100 g" for a variant). */
  detail: Pick<StockDetail, 'product_id' | 'product_name' | 'quantity_on_hand' | 'quantity_reserved'>;
  /** Migration 045: adjust this variant's own stock row instead of the product's. */
  variantId?: string | null;
  onClose(): void;
  onDone(resultOnHand: number): void | Promise<void>;
}) {
  const [type, setType] = useState<ManualAdjustmentType>('PURCHASE_RESTOCK');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);

  const onHand = detail.quantity_on_hand;
  const typeInfo = TYPES.find((t) => t.id === type)!;
  const parsed = /^\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : null;

  // The signed change this form will send - a preview only, the backend
  // computes and returns the real resulting figure.
  let delta: number | null = null;
  if (parsed !== null) {
    if (type === 'PURCHASE_RESTOCK') delta = parsed;
    else if (type === 'DAMAGE_WRITE_OFF') delta = -parsed;
    else delta = parsed - onHand;
  }
  const after = delta === null ? null : onHand + delta;

  function validate(): string | null {
    if (quantity.trim() === '') return `Enter ${typeInfo.quantityLabel.toLowerCase()}.`;
    if (parsed === null) return 'Use a whole number of units (no decimals or signs).';
    if (type !== 'INVENTORY_AUDIT_ADJUSTMENT' && parsed === 0) return 'The quantity must be at least 1.';
    if (delta === 0) return `The count matches what is on hand (${onHand}); there is nothing to correct.`;
    if (after !== null && after < 0) return `Only ${onHand} on hand - that would go below zero.`;
    if (after !== null && after < detail.quantity_reserved) {
      return `${detail.quantity_reserved} units are reserved, so on hand cannot go below that.`;
    }
    if (reason.trim().length === 0) return 'Give a reason - it is kept in the ledger.';
    if (reason.length > 500) return 'Keep the reason under 500 characters.';
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return; // one request per click, whatever the button state
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await inventoryApi.stock.adjust(detail.product_id, {
        adjustment_type: type,
        quantity_delta: delta!,
        notes: reason.trim(),
        ...(variantId ? { variant_id: variantId } : {}),
      });
      await onDone(result.inventory.quantity_on_hand);
    } catch (err) {
      setError(inventoryErrorMessage(err, 'The adjustment was not recorded.'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Adjust stock for ${detail.product_name}`}>
      <form className="modal__panel" onSubmit={submit}>
        <h2 className="modal__title">Adjust stock · {detail.product_name}</h2>
        <p className="form__note">This changes the operational stock count and is recorded permanently in the ledger.</p>

        <fieldset className="choice">
          <legend className="field__label">Type</legend>
          {TYPES.map((t) => (
            <label key={t.id} className={`choice__option${type === t.id ? ' is-selected' : ''}`}>
              <input
                type="radio"
                name="adjustment-type"
                value={t.id}
                checked={type === t.id}
                onChange={() => {
                  setType(t.id);
                  setError(null);
                }}
              />
              <span>
                <strong>{ADJUSTMENT_LABEL[t.id]}</strong>
                <em>{t.hint}</em>
              </span>
            </label>
          ))}
        </fieldset>

        <Field label={typeInfo.quantityLabel}>
          <input
            className="input input--mono"
            inputMode="numeric"
            value={quantity}
            onChange={(event) => {
              setQuantity(event.target.value);
              setError(null);
            }}
          />
        </Field>

        <Field label="Reason" hint="Kept in the ledger, e.g. 'Received from Dharga Town Central Grocery'.">
          <textarea
            className="input"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setError(null);
            }}
          />
        </Field>

        <p className="preview mono" aria-live="polite">
          On hand {onHand}
          {after !== null && delta !== 0 ? (
            <>
              {' '}
              → <strong>{after}</strong>{' '}
              <span className={delta! > 0 ? 'delta--up' : 'delta--down'}>({formatDelta(delta!)})</span>
            </>
          ) : null}
        </p>

        {error ? <p className="field__error" role="alert">{error}</p> : null}

        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? <Spinner label="Recording" /> : 'Record adjustment'}
          </button>
        </div>
      </form>
    </div>
  );
}
