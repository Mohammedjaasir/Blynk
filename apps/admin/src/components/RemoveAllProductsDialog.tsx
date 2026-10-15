import { useEffect, useState } from 'react';
import { products as productsApi } from '../api/resources';
import type { RemoveAllProductsPreview, RemoveAllProductsResult } from '../api/types';
import { errorMessage } from '../lib/apiErrors';
import { Spinner } from './ui';
import './removeAllProducts.css';

/** What the operator must type to enable the destructive button. */
export const REMOVE_ALL_PRODUCTS_WORDS = 'DELETE ALL PRODUCTS';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Products -> "Remove all products" (owner, 2026-10-14; ADMIN only, never in
 * Ops - like "Remove all product images"). Loads the dry run
 * (GET /admin/products/remove-all/preview), explains what happens, and only
 * enables the red button once DELETE ALL PRODUCTS is typed exactly.
 * POST /admin/products/remove-all hides (soft-deletes) every product and its
 * variants, switches off combo packs and home banners that used them, clears
 * "notify me" requests and - when ticked - every product image. Orders keep
 * their items; categories stay; the same SKUs can be bulk-uploaded again.
 */
export function RemoveAllProductsDialog({ onClose, onDone }: { onClose(): void; onDone(): void | Promise<void> }) {
  const [preview, setPreview] = useState<RemoveAllProductsPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alsoImages, setAlsoImages] = useState(true);
  const [typed, setTyped] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RemoveAllProductsResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    productsApi
      .removeAllPreview()
      .then((p) => !cancelled && setPreview(p))
      .catch((err) => !cancelled && setLoadError(errorMessage(err, 'Could not count the products.')));
    return () => {
      cancelled = true;
    };
  }, []);

  async function run() {
    setError(null);
    setRunning(true);
    try {
      const done = await productsApi.removeAll(REMOVE_ALL_PRODUCTS_WORDS, alsoImages);
      setResult(done);
      await onDone();
    } catch (err) {
      setError(errorMessage(err, 'Could not remove the products.'));
    } finally {
      setRunning(false);
    }
  }

  const title = 'Remove all products';
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__panel modal__panel--wide rap">
        <div className="rap__card">
          <h2 className="modal__title rap__title">{title}</h2>
          {result ? (
            <>
              <p className="modal__message" role="status">
                Done. {plural(result.products_removed, 'product')} removed
                {result.variants_removed ? ` (with ${plural(result.variants_removed, 'size/pack', 'sizes/packs')})` : ''}.
              </p>
              <ul className="rap__list" aria-label="Result">
                <li>{plural(result.combos_switched_off, 'combo pack')} switched off</li>
                <li>{plural(result.promotions_switched_off, 'home banner')} switched off</li>
                <li>{plural(result.stock_alerts_cleared, '"notify me" request')} cleared</li>
                <li>{plural(result.open_orders_kept, 'open order')} kept as they are</li>
                {result.images ? (
                  <li>
                    Images cleared from {plural(result.images.products_cleared, 'product')}; {plural(result.images.files_deleted, 'file')}{' '}
                    deleted
                  </li>
                ) : (
                  <li>Product images kept</li>
                )}
              </ul>
              <p className="form__note">Load the new list with Bulk upload (Excel).</p>
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
                <Spinner label="Counting products" />
              ) : (
                <dl className="rap__counts" aria-label="What will change">
                  <div>
                    <dt>Products</dt>
                    <dd>{preview.products}</dd>
                  </div>
                  <div>
                    <dt>Sizes/packs</dt>
                    <dd>{preview.variants}</dd>
                  </div>
                  <div>
                    <dt>With images</dt>
                    <dd>{preview.products_with_images}</dd>
                  </div>
                  <div>
                    <dt>Combo packs</dt>
                    <dd>{preview.combos}</dd>
                  </div>
                  <div>
                    <dt>Home banners</dt>
                    <dd>{preview.promotions}</dd>
                  </div>
                  <div>
                    <dt>"Notify me"</dt>
                    <dd>{preview.stock_alerts}</dd>
                  </div>
                  <div>
                    <dt>Open orders</dt>
                    <dd>{preview.open_orders}</dd>
                  </div>
                </dl>
              )}
              <ul className="rap__list">
                <li>Every product is hidden everywhere: the customer app, search, Ops and this site.</li>
                <li>
                  Old and open orders keep their items, names and prices
                  {preview && preview.open_orders ? ` - the ${plural(preview.open_orders, 'open order')} can still be packed and delivered` : ''}.
                </li>
                <li>Combo packs and home banners that use a product are switched off; "notify me" requests are cleared.</li>
                <li>Categories, settings, customers and riders stay as they are.</li>
                <li>The same SKUs can be loaded again with Bulk upload (Excel).</li>
              </ul>
              <label className="toggle">
                <input type="checkbox" checked={alsoImages} onChange={(e) => setAlsoImages(e.target.checked)} disabled={running} />
                <span>
                  Also delete product images
                  <em>
                    {preview
                      ? `${plural(preview.images.files, 'uploaded file')} (${preview.images.files_on_disk} on disk), from ${plural(preview.images.products, 'product')} and ${plural(preview.images.combos, 'combo pack')}. Cannot be undone.`
                      : 'The uploaded photos are deleted for good.'}
                  </em>
                </span>
              </label>
              <label className="field">
                <span className="field__label">Type {REMOVE_ALL_PRODUCTS_WORDS} to confirm</span>
                <input
                  className="input"
                  value={typed}
                  autoComplete="off"
                  spellCheck={false}
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
                  disabled={!preview || typed !== REMOVE_ALL_PRODUCTS_WORDS || running}
                  onClick={() => void run()}
                >
                  {running ? <Spinner label="Removing products" /> : 'Remove all products'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
