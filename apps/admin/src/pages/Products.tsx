import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiRequest } from '../api/client';
import { categories as categoriesApi, products as productsApi } from '../api/resources';
import type { AdminProduct, Category } from '../api/types';
import { PageHeader } from '../components/Layout';
import { Badge, ConfirmDialog, EmptyState, Spinner, useToast } from '../components/ui';

type StatusFilter = 'all' | 'active' | 'inactive';

/**
 * Operational product table: dense, searchable, and able to show inactive
 * products so they can be found and re-enabled.
 */
export function Products() {
  const navigate = useNavigate();
  const toast = useToast();

  const [rows, setRows] = useState<AdminProduct[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [error, setError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<AdminProduct | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const query = new URLSearchParams();
      if (search.trim()) query.set('search', search.trim());
      if (categoryId) query.set('category_id', categoryId);
      if (status !== 'all') query.set('is_active', String(status === 'active'));
      query.set('limit', '200');

      const data = await apiRequest<{ products: AdminProduct[] }>(
        `/admin/products?${query.toString()}`
      );
      setRows(data.products);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load products.');
      setRows([]);
    }
  }, [search, categoryId, status]);

  useEffect(() => {
    void categoriesApi.listAdmin().then(setCategories).catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const categoryName = useMemo(() => {
    const map = new Map(categories.map((category) => [category.id, category.name]));
    return (id: string) => map.get(id) ?? '-';
  }, [categories]);

  async function toggleActive(product: AdminProduct) {
    try {
      await productsApi.update(product.id, { is_active: !product.is_active });
      toast.success(
        `${product.name} is now ${product.is_active ? 'inactive' : 'active'}.`
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the product.');
    } finally {
      setPendingToggle(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything in the catalog, including products hidden from customers."
        actions={
          <button type="button" className="button" onClick={() => navigate('/products/new')}>
            Add product
          </button>
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
        <select
          className="input"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select
          className="input"
          value={status}
          onChange={(event) => setStatus(event.target.value as StatusFilter)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
        </select>
      </div>

      {error ? <p className="field__error">{error}</p> : null}

      {rows === null ? (
        <Spinner label="Loading products" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No products match"
          message="Try a different search or filter."
        />
      ) : (
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Image</th>
              <th scope="col">Product</th>
              <th scope="col">Category</th>
              <th scope="col" className="num">Selling price</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="thumb">
                    {product.image_url ? (
                      <img src={product.image_url} alt="" />
                    ) : (
                      <span className="thumb__empty">—</span>
                    )}
                  </div>
                </td>
                <td>
                  <span className="cell__primary">{product.name}</span>
                  <span className="cell__secondary">
                    {product.sku} · {product.unit}
                  </span>
                </td>
                <td>{product.category_name ?? categoryName(product.category_id)}</td>
                <td className="num">
                  Rs. {Number(product.calculated_selling_price ?? 0).toFixed(2)}
                </td>
                <td>
                  <Badge tone={product.is_active ? 'active' : 'inactive'}>
                    {product.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  {!product.is_available ? (
                    <Badge tone="muted">Unavailable</Badge>
                  ) : null}
                </td>
                <td className="cell__secondary">
                  {product.updated_at
                    ? new Date(product.updated_at).toLocaleDateString()
                    : '-'}
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => navigate(`/products/${product.id}`)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setPendingToggle(product)}
                    >
                      {product.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
    </>
  );
}
