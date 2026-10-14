import { useEffect, useState } from 'react';
import { products as productsApi } from '../api/resources';
import type { RemoveImagesPreview, RemoveImagesResult } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { Spinner } from './ui';

/** What the operator must type to enable the destructive button. */
export const REMOVE_CONFIRM_WORD = 'REMOVE';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Products -> "Remove all product images" (owner, 2026-10-14; ADMIN only).
 * Loads the dry run (GET /admin/products/remove-images/preview), says what
 * will be cleared, and only enables the button once REMOVE is typed exactly.
 * POST /admin/products/remove-images {confirm: "REMOVE"} clears every
 * product's and combo pack's image link and deletes the uploaded files no
 * category, promotion or doctor photo still uses. Cannot be undone.
 */
export function RemoveProductImagesDialog({ onClose, onDone }: { onClose(): void; onDone(): void | Promise<void> }) {
  const [preview, setPreview] = useState<RemoveImagesPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RemoveImagesResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    productsApi
      .removeImagesPreview()
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not count the product images.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    setError(null);
    setRunning(true);
    try {
      const done = await productsApi.removeAllImages(REMOVE_CONFIRM_WORD);
      setResult(done);
      await onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the product images.'));
    } finally {
      setRunning(false);
    }
  }

  const title = 'Remove all product images';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__panel">
        <h2 className="modal__title">{title}</h2>
        {result ? (
          <>
            <p className="modal__message" role="status">
              Done. Images removed from {plural(result.products_cleared, 'product')} and{' '}
              {plural(result.combos_cleared, 'combo pack')}.
            </p>
            <ul className="modal__message" aria-label="Result">
              <li>{plural(result.files_deleted, 'file')} deleted</li>
              <li>{plural(result.files_missing, 'file')} already missing</li>
              <li>{plural(result.files_kept_in_use, 'file')} kept (still used by a category, promotion or doctor)</li>
            </ul>
            <div className="modal__actions">
              <button type="button" className="button" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            {loadError ? (
              <p className="field__error">{loadError}</p>
            ) : !preview ? (
              <Spinner label="Counting product images" />
            ) : (
              <p className="modal__message">
                {plural(preview.products, 'product')}, {plural(preview.combos, 'combo pack')} and{' '}
                {plural(preview.files, 'uploaded file')} ({preview.files_on_disk} on disk) will be affected
                {preview.external_links ? `, plus ${plural(preview.external_links, 'external link')} cleared` : ''}.
                Category, promotion and doctor images are not touched. This cannot be undone.
              </p>
            )}
            <label className="field">
              <span className="field__label">Type {REMOVE_CONFIRM_WORD} to confirm</span>
              <input
                className="input"
                value={typed}
                autoComplete="off"
                onChange={(e) => setTyped(e.target.value)}
                disabled={!preview || running}
              />
            </label>
            {error ? (
              <p className="field__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="modal__actions">
              <button type="button" className="button button--ghost" onClick={onClose} disabled={running}>
                Cancel
              </button>
              <button
                type="button"
                className="button button--danger"
                disabled={!preview || typed !== REMOVE_CONFIRM_WORD || running}
                onClick={() => void run()}
              >
                {running ? <Spinner label="Removing images" /> : 'Remove all images'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
