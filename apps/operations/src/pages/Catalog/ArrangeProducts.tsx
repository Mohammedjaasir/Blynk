import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { catalog } from '../../api/resources';
import type { ArrangeProduct } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, EmptyState, Spinner } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';
import { formatMoney } from '../../lib/orders';

/** `items` with the one at `from` moved to `to`; the same array when it can't move. */
export function moved<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items;
  const next = items.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Arrange products (owner, 2026-10-10): "ops and admin can decide which
 * should be shown first" in a category.
 *
 * Lists the category's products - its sub-categories' too, exactly what a
 * customer sees on that category's page - in the order customers see them
 * (`GET /admin/categories/:id/product-order`). Top / ↑ / ↓ move a product
 * here on the screen only; Save sends the whole list (`PUT .../product-order`)
 * and the customer app shows them in that order. Products added later, never
 * arranged, follow the arranged ones A-Z until the next Save.
 */
export function ArrangeProducts() {
  const { id = '' } = useParams();
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [saved, setSaved] = useState<ArrangeProduct[] | null>(null);
  const [items, setItems] = useState<ArrangeProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await catalog.categories.productOrder(id);
      setCategoryName(data.category.name);
      setSaved(data.products);
      setItems(data.products);
      setError(null);
    } catch (err) {
      setError(catalogErrorMessage(err));
      setSaved([]);
      setItems([]);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty =
    items !== null && saved !== null && (items.length !== saved.length || items.some((p, i) => p.id !== saved[i].id));
  const unarranged = (saved ?? []).some((p) => p.display_order === null);

  function move(from: number, to: number) {
    if (!items) return;
    const next = moved(items, from, to);
    if (next === items) return;
    setItems(next);
    setNotice(null);
  }

  async function save() {
    if (!items) return;
    setSaving(true);
    setNotice(null);
    setError(null);
    try {
      const data = await catalog.categories.setProductOrder(id, items.map((p) => p.id));
      setSaved(data.products);
      setItems(data.products);
      setNotice('Order saved. Customers now see the products in this order.');
    } catch (err) {
      setError(catalogErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title={categoryName ? `Arrange products: ${categoryName}` : 'Arrange products'}
        description="Customers see this category's products in this order - first at the top."
        actions={
          <>
            <Link className="button button--ghost" to="/catalog/categories">
              Back to categories
            </Link>
          </>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}
      {notice ? (
        <p className="form__note" role="status">
          {notice}
        </p>
      ) : null}

      {items === null ? (
        <Spinner label="Loading products" />
      ) : items.length === 0 ? (
        error ? null : <EmptyState title="No products in this category yet" message="Add products to it first." />
      ) : (
        <>
          {unarranged && !dirty ? (
            <p className="page__note">
              Products nobody has arranged yet are listed A-Z after the arranged ones. Save to keep this order.
            </p>
          ) : null}
          {dirty ? (
            <p className="page__note" role="status">
              Unsaved changes - Save order to show customers this order.
            </p>
          ) : null}
          <ol className="cat-list" aria-label="Products in order">
            {items.map((product, index) => (
              <li key={product.id} className="cat-row cat-row--promo">
                <span className="cat-row__order" aria-hidden="true">
                  {index + 1}
                </span>
                <div className="cat-row__thumb" aria-hidden="true">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt=""
                      style={{ objectPosition: `${product.image_focal_x}% ${product.image_focal_y}%` }}
                    />
                  ) : (
                    <span className="cat-row__thumb-empty">No image</span>
                  )}
                </div>
                <div className="cat-row__main">
                  <p className="cat-row__title">{product.name}</p>
                  <p className="cat-row__meta">
                    {[product.pack_size || product.unit, formatMoney(product.selling_price)].filter(Boolean).join(' · ')}
                  </p>
                  {product.category_id !== id || !product.is_active || !product.is_available ? (
                    <div className="cat-row__badges">
                      {product.category_id !== id ? <span className="cat-row__order">{`In ${product.category_name}`}</span> : null}
                      {!product.is_active ? <Badge tone="inactive">Inactive</Badge> : null}
                      {product.is_active && !product.is_available ? <Badge tone="muted">Sold out</Badge> : null}
                    </div>
                  ) : null}
                </div>
                <div className="cat-row__actions">
                  <div className="order-cell">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Move ${product.name} to the top`}
                      disabled={saving || index === 0}
                      onClick={() => move(index, 0)}
                    >
                      Top
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Move ${product.name} up`}
                      disabled={saving || index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      aria-label={`Move ${product.name} down`}
                      disabled={saving || index === items.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <div className="form__actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={saving}
              onClick={() => {
                setItems([...items].sort((a, b) => a.name.localeCompare(b.name)));
                setNotice(null);
              }}
            >
              Sort A-Z
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={!dirty || saving}
              onClick={() => {
                setItems(saved);
                setNotice(null);
              }}
            >
              Discard changes
            </button>
            <button type="button" className="button" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? <Spinner label="Saving order" /> : 'Save order'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
