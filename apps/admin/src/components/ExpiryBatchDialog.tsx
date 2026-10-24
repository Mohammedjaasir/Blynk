import { useEffect, useState, type FormEvent } from 'react';
import { expiryApi, expiryErrorMessage, type StockBatch } from '../api/expiry';
import { products as productsApi } from '../api/resources';
import type { StaffVariant } from '../api/types';
import { ProductPicker } from '../pages/Promotions';
import { parseBatchForm, type BatchForm } from '../lib/expiry';
import { Field } from './ui';

/**
 * Add a batch (wave 2, 2026-10-25; migration 059): pick the product (and its size when it has sizes),
 * how many arrived and the expiry date. With `batch` it edits that open batch instead (quantity, date,
 * code, note; the product cannot change). Adding a batch also switches the product to "Track expiry dates".
 * Batches are a register: adding one never changes the stock count (restock does that).
 */
export function ExpiryBatchDialog({
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
  const [variantId, setVariantId] = useState<string>(batch?.variant_id ?? '');
  const [form, setForm] = useState<BatchForm>({
    quantity: batch ? String(batch.quantity) : '',
    expires_on: batch?.expires_on ?? '',
    batch_code: batch?.batch_code ?? '',
    note: batch?.note ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // a product with sizes: the batch belongs to one size
  useEffect(() => {
    if (editing || !product.id) {
      setVariants([]);
      return;
    }
    let live = true;
    productsApi
      .listVariants(product.id)
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
      <form className="modal__panel expiry-dialog" onSubmit={submit} noValidate>
        <h2 className="modal__title">{editing ? `Edit batch: ${batch.product_name}` : 'Add a batch'}</h2>
        <p className="modal__message">
          {editing
            ? 'Fix the count, the date or the code. The stock count does not change.'
            : 'Write down what arrived and when it expires. This is a note for staff: it does not change the stock count (use Restock for that).'}
        </p>

        {editing ? null : <ProductPicker value={product.id} name={product.name} onChange={(id, name) => { setProduct({ id, name }); setVariantId(''); }} />}

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

        <div className="form__row">
          <Field label="How many">
            <input className="input" inputMode="numeric" value={form.quantity} onChange={(e) => set({ quantity: e.target.value })} />
          </Field>
          <Field label="Expiry date">
            <input className="input" type="date" value={form.expires_on} onChange={(e) => set({ expires_on: e.target.value })} />
          </Field>
        </div>
        <div className="form__row">
          <Field label="Batch code" hint="Optional - from the pack">
            <input className="input" maxLength={60} value={form.batch_code} onChange={(e) => set({ batch_code: e.target.value })} />
          </Field>
          <Field label="Note" hint="Optional">
            <input className="input" maxLength={300} value={form.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        </div>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="modal__actions">
          <button type="button" className="button button--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="button" disabled={busy}>
            {busy ? 'Saving...' : editing ? 'Save batch' : 'Add batch'}
          </button>
        </div>
      </form>
    </div>
  );
}
