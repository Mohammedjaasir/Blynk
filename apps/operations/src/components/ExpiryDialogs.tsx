import { useEffect, useState, type FormEvent } from 'react';
import { expiryApi, expiryErrorMessage, type StockBatch } from '../api/expiry';
import { catalog } from '../api/resources';
import type { StaffVariant } from '../api/types';
import { TargetProductPicker } from '../pages/Catalog/Promotions';
import { batchTitle, dayText, parseBatchForm, unitsText, discardedText, type BatchForm } from '../lib/expiry';
import { Field } from './ui';
import './expiry.css';

/**
 * Add / edit a batch (wave 2, 2026-10-25; migration 059), phone-first: big fields, big buttons. Pick the
 * product (and its size when it has sizes), how many arrived and the date printed on the pack. With `batch`
 * it edits that open batch (quantity, date, code, note). A batch is a note for staff: it never changes the
 * stock count (Adjust stock -> Stock received does that, and can take the date too).
 */
export function BatchSheet({
  batch,
  onClose,
  onSaved,
}: {
  batch?: StockBatch;
  onClose(): void;
  onSaved(message: string): void;
}) {
  const editing = !!batch;
  const [product, setProduct] = useState<{ id: string; name: string | null }>({ id: batch?.product_id ?? '', name: batch?.product_name ?? null });
  const [variants, setVariants] = useState<StaffVariant[]>([]);
  const [variantId, setVariantId] = useState(batch?.variant_id ?? '');
  const [form, setForm] = useState<BatchForm>({
    quantity: batch ? String(batch.quantity) : '',
    expires_on: batch?.expires_on ?? '',
    batch_code: batch?.batch_code ?? '',
    note: batch?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing || !product.id) {
      setVariants([]);
      return;
    }
    let live = true;
    catalog.products.variants
      .list(product.id)
      .then((v) => live && setVariants(v.filter((x) => x.is_active)))
      .catch(() => live && setVariants([]));
    return () => {
      live = false;
    };
  }, [editing, product.id]);

  const set = (change: Partial<BatchForm>) => setForm((f) => ({ ...f, ...change }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!editing && !product.id) return setError('Choose the product first.');
    if (!editing && variants.length > 0 && !variantId) return setError('Choose which size this batch is.');
    const parsed = parseBatchForm(form);
    if ('error' in parsed) return setError(parsed.error);
    setBusy(true);
    try {
      if (batch) {
        await expiryApi.update(batch.id, parsed.value);
        onSaved('Batch updated.');
      } else {
        await expiryApi.add({ product_id: product.id, variant_id: variantId || null, ...parsed.value });
        onSaved(`Batch of ${product.name ?? 'the product'} added.`);
      }
    } catch (err) {
      setError(expiryErrorMessage(err, 'Could not save the batch.'));
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={editing ? 'Edit batch' : 'Add batch'}>
      <form className="modal__panel expiry-sheet" onSubmit={submit} noValidate>
        <h2 className="modal__title">{editing ? `Edit batch: ${batch.product_name}` : 'Add a batch'}</h2>
        <p className="form__note">
          {editing ? 'Fix the count, the date or the code. The stock count does not change.' : 'Write down what arrived and its expiry date. The stock count does not change.'}
        </p>

        {editing ? null : (
          <TargetProductPicker
            selectedId={product.id || null}
            selectedName={product.name}
            onPick={(p) => {
              setProduct({ id: p?.id ?? '', name: p?.name ?? null });
              setVariantId('');
            }}
          />
        )}

        {!editing && variants.length > 0 ? (
          <Field label="Size">
            <select className="input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
              <option value="">Choose a size</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          </Field>
        ) : null}

        <Field label="How many">
          <input className="input input--mono" inputMode="numeric" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
        </Field>
        <Field label="Expiry date">
          <input className="input" type="date" value={form.expires_on} onChange={(e) => set({ expires_on: e.target.value })} />
        </Field>
        <Field label="Batch code" hint="Optional - from the pack">
          <input className="input" maxLength={60} value={form.batch_code} onChange={(e) => set({ batch_code: e.target.value })} />
        </Field>
        <Field label="Note" hint="Optional">
          <input className="input" maxLength={300} value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </Field>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions expiry-sheet__actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Saving...' : editing ? 'Save batch' : 'Add batch'}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Throw a batch away: why, and whether the stock count goes down with it. */
export function DiscardSheet({ batch, onClose, onDone }: { batch: StockBatch; onClose(): void; onDone(message: string): void }) {
  const [reason, setReason] = useState<'EXPIRED' | 'WASTE'>(batch.severity === 'expired' ? 'EXPIRED' : 'WASTE');
  const [reduce, setReduce] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await expiryApi.discard(batch.id, { reason, reduce_stock: reduce });
      onDone(discardedText(batchTitle(batch), res.stock_removed));
    } catch (err) {
      setError(expiryErrorMessage(err, 'Could not discard the batch.'));
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Discard batch">
      <div className="modal__panel expiry-sheet">
        <h2 className="modal__title">{`Discard ${batchTitle(batch)}?`}</h2>
        <p className="modal__message">
          {`${unitsText(batch.quantity)} (${batch.label.toLowerCase()}, ${dayText(batch.expires_on)}) will be thrown away and the batch closed. This cannot be undone.`}
        </p>
        <div className="segmented" role="radiogroup" aria-label="Why">
          {(['EXPIRED', 'WASTE'] as const).map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={reason === r}
              className={reason === r ? 'segmented__item is-selected' : 'segmented__item'}
              onClick={() => setReason(r)}
            >
              {r === 'EXPIRED' ? 'Expired' : 'Waste (damaged / spoiled)'}
            </button>
          ))}
        </div>
        <label className="expiry-check">
          <input type="checkbox" checked={reduce} onChange={(e) => setReduce(e.target.checked)} />
          <span>Take it off the stock count</span>
        </label>
        <p className="form__note">
          {reduce
            ? 'The stock count goes down by the same number, as a write-off in the stock history (never below zero).'
            : 'Only the batch is closed. Use this if you already corrected the stock count by hand.'}
        </p>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions expiry-sheet__actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="button button--danger" onClick={() => void go()} disabled={busy}>
            {busy ? 'Discarding...' : 'Discard batch'}
          </button>
        </div>
      </div>
    </div>
  );
}
