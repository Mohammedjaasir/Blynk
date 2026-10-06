import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { catalog } from '../../api/resources';
import type { AdminProduct, Category } from '../../api/types';
import { PageHeader } from '../../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Spinner } from '../../components/ui';
import { catalogErrorMessage } from '../../lib/catalog';

type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * Product table (task F5, plan §12) - replaces the Catalog hub's own
 * placeholder for this screen. Ported from `apps/admin/src/pages/Products.tsx`
 * (a fresh implementation, not an import - common.md rule 2), rendered as a
 * mobile-first card list rather than Admin's desktop `<table>` - the same
 * departure F3's Orders board already made for the same reason (F1's Layout
 * is a single-column, 720px-max, bottom-tab shell with no room for a wide
 * table; plan §8/§23/§24).
 *
 * Every price shown is exactly what `GET /admin/products` returns
 * (`calculated_selling_price`) - never computed here (common.md rule 8).
 */
export function Products() {
  const navigate = useNavigate();

  const [rows, setRows] = useState<AdminProduct[] | null>(null);
  /** More products exist than were loaded (see `products.listAll`). */
  const [capped, setCapped] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<AdminProduct | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminProduct | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { products, capped: more } = await catalog.products.listAll({
        search: search.trim() || undefined,
        category_id: categoryId || undefined,
        is_active: status === 'all' ? undefined : status === 'active',
      });
      setRows(products);
      setCapped(more);
    } catch (err) {
      setError(catalogErrorMessage(err));
      setRows([]);
    }
  }, [search, categoryId, status]);

  useEffect(() => {
    void catalog.categories.list().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? '-';
  }, [categories]);

  async function toggleActive(product: AdminProduct) {
    try {
      await catalog.products.update(product.id, { is_active: !product.is_active });
      setNotice(`${product.name} is now ${product.is_active ? 'inactive' : 'active'}.`);
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    } finally {
      setPendingToggle(null);
    }
  }

  async function deleteProduct(product: AdminProduct) {
    try {
      const result = await catalog.products.remove(product.id);
      setNotice(
        result.mode === 'SOFT'
          ? `${product.name} was deleted. Its past orders keep their history.`
          : `${product.name} was deleted.`
      );
      await load();
    } catch (err) {
      setNotice(catalogErrorMessage(err));
    } finally {
      setPendingDelete(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        title="Products"
        description="Everything in the catalog, including products hidden from customers."
        actions={
          <>
            <Link className="button button--ghost" to="/catalog/products/import">
              Import
            </Link>
            <button type="button" className="button" onClick={() => navigate('/catalog/products/new')}>
              Add product
            </button>
          </>
        }
      />

      <div className="filters">
        <input
          className="input"
          placeholder="Search name, SKU or barcode"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search products"
        />
        <select className="input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)} aria-label="Filter by category">
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="Filter by status">
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>

      {notice ? (
        <p className="field__error" role="status">
          {notice}
          <button type="button" className="field__error-dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
            ×
          </button>
        </p>
      ) : null}
      {error ? <p className="field__error">{error}</p> : null}
      {rows && capped ? (
        <p className="banner" role="status">
          Showing the first {rows.length} products. Search or filter by category to find the rest.
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading products" />
      ) : rows.length === 0 ? (
        <EmptyState title="No products match" message="Try a different search or filter." />
      ) : (
        <ul className="cat-list">
          {rows.map((product) => (
            <li key={product.id} className="cat-row">
              <div className="cat-row__thumb">
                {product.image_url ? (
                  // The row thumb crops like a real tile does, so the list
                  // shows the same part of the photo the operator chose.
                  <img
                    src={product.image_url}
                    alt=""
                    style={{
                      objectPosition: `${product.image_focal_x ?? 50}% ${product.image_focal_y ?? 50}%`,
                    }}
                  />
                ) : (
                  <span className="thumb__empty">—</span>
                )}
              </div>
              <div className="cat-row__main">
                <p className="cat-row__title">{product.name}</p>
                <p className="cat-row__meta">
                  {product.sku} · {product.unit} · {product.category_name ?? categoryName(product.category_id)}
                </p>
                <p className="cat-row__price">LKR {Number(product.calculated_selling_price ?? 0).toFixed(2)}</p>
                <div className="cat-row__badges">
                  <Badge tone={product.is_active ? 'active' : 'inactive'}>{product.is_active ? 'Active' : 'Inactive'}</Badge>
                  {!product.is_available ? <Badge tone="muted">Unavailable</Badge> : null}
                </div>
              </div>
              <div className="cat-row__actions">
                <Link className="button button--ghost button--sm" to={`/catalog/products/${product.id}`}>
                  Edit
                </Link>
                <button type="button" className="button button--ghost button--sm" onClick={() => setPendingToggle(product)}>
                  {product.is_active ? 'Disable' : 'Enable'}
                </button>
                <button
                  type="button"
                  className="button button--ghost button--sm"
                  onClick={() => setPendingDelete(product)}
                  aria-label={`Delete ${product.name}`}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingToggle ? (
        <ConfirmDialog
          title={pendingToggle.is_active ? 'Disable product' : 'Enable product'}
          message={
            pendingToggle.is_active
              ? `${pendingToggle.name} will stop appearing in the customer app. Past orders keep their history.`
              : `${pendingToggle.name} will appear in the customer catalog again.`
          }
          confirmLabel={pendingToggle.is_active ? 'Disable' : 'Enable'}
          destructive={pendingToggle.is_active}
          onConfirm={() => void toggleActive(pendingToggle)}
          onCancel={() => setPendingToggle(null)}
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title="Delete product"
          message={`Delete ${pendingDelete.name}? Customers will no longer see it.`}
          confirmLabel="Delete"
          destructive
          onConfirm={() => void deleteProduct(pendingDelete)}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
