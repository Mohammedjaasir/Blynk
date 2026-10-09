import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { categories as categoriesApi } from '../api/resources';
import type { ArrangeProduct } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { formatMoney } from '../lib/orders';

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
 * The category's products - its sub-categories' too, exactly what a customer
 * sees on that category's page - in customer order
 * (`GET /admin/categories/:id/product-order`). Top / ↑ / ↓ move a product on
 * this screen only; "Save order" sends the whole list (`PUT .../product-order`).
 * Products added later, never arranged, follow the arranged ones A-Z until
 * the next save.
 */
export function ArrangeProducts() {
  const { id = '' } = useParams();
  const toast = useToast();
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [saved, setSaved] = useState<ArrangeProduct[] | null>(null);
  const [items, setItems] = useState<ArrangeProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await categoriesApi.productOrder(id);
      setCategoryName(data.category.name);
      setSaved(data.products);
      setItems(data.products);
      setError(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not load the products.'));
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
    if (next !== items) setItems(next);
  }

  async function save() {
    if (!items) return;
    setSaving(true);
    try {
      const data = await categoriesApi.setProductOrder(id, items.map((p) => p.id));
      setSaved(data.products);
      setItems(data.products);
      toast.success('Order saved. Customers now see the products in this order.');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save the order.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader
        title={categoryName ? `Arrange products: ${categoryName}` : 'Arrange products'}
        description="Customers see this category's products in this order - first at the top."
        actions={
          <Link className="button button--ghost" to="/categories">
            Back to categories
          </Link>
        }
      />

      {error ? <p className="field__error">{error}</p> : null}

      {items === null ? (
        <Spinner label="Loading products" />
      ) : items.length === 0 ? (
        error ? null : <EmptyState title="No products in this category yet" message="Add products to it first." />
      ) : (
        <>
          {dirty ? (
            <p className="form__note" role="status">
              Unsaved changes - Save order to show customers this order.
            </p>
          ) : unarranged ? (
            <p className="form__note">
              Products nobody has arranged yet are listed A-Z after the arranged ones. Save to keep this order.
            </p>
          ) : null}
          <div className="table-wrap">
            <table className="table" aria-label="Products in order">
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col">Image</th>
                  <th scope="col">Product</th>
                  <th scope="col" className="num">Price</th>
                  <th scope="col">Move</th>
                </tr>
              </thead>
              <tbody>
                {items.map((product, index) => (
                  <tr key={product.id}>
                    <td className="num">{index + 1}</td>
                    <td>
                      <div className="thumb">
                        {product.image_url ? (
                          <img
                            src={product.image_url}
                            alt=""
                            style={{ objectPosition: `${product.image_focal_x}% ${product.image_focal_y}%` }}
                          />
                        ) : (
                          <span className="thumb__empty">—</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className="cell__primary">{product.name}</span>
                      <span className="cell__secondary">
                        {[product.pack_size || product.unit, product.category_id !== id ? `In ${product.category_name}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                      {!product.is_active ? <Badge tone="inactive">Inactive</Badge> : null}
                      {product.is_active && !product.is_available ? <Badge tone="muted">Sold out</Badge> : null}
                    </td>
                    <td className="num">{formatMoney(product.selling_price)}</td>
                    <td>
                      <div className="row-actions">
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form__actions">
            <button
              type="button"
              className="button button--ghost"
              disabled={saving}
              onClick={() => setItems([...items].sort((a, b) => a.name.localeCompare(b.name)))}
            >
              Sort A-Z
            </button>
            <button type="button" className="button button--ghost" disabled={!dirty || saving} onClick={() => setItems(saved)}>
              Discard changes
            </button>
            <button type="button" className="button" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? <Spinner label="Saving order" /> : 'Save order'}
            </button>
          </div>
        </>
      )}
    </>
  );
}
