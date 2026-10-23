import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { categories as categoriesApi, products as productsApi } from '../api/resources';
import type { AdminProduct, Category } from '../api/types';
import { useSignedInUser } from '../auth/AuthContext';
import { PageHeader } from '../components/Layout';
import { RemoveProductImagesDialog } from '../components/RemoveProductImagesDialog';
import { RemoveAllProductsDialog } from '../components/RemoveAllProductsDialog';
import { categoryOptions } from '../lib/categoryTree';
import { Badge, ConfirmDialog, EmptyState, Spinner, useToast } from '../components/ui';
import { errorMessage } from '../lib/apiErrors';
import { formatMoney } from '../lib/orders';
import { PRICING_SOURCE_LABEL, formatLkr, formatPercent, formatPriceRange, mrpCappedNote } from '../lib/pricing';
import { leadTimeText } from '../lib/stock';
import { StockChip } from '../components/ProductVariants';

type StatusFilter = 'all' | 'active' | 'inactive';
/** "LKR 1 or less": the placeholder-priced products waiting for their photos (owner, 2026-10-23). */
type PriceFilter = 'all' | 'placeholder';

/** What the customer pays for it before offers: the row's price, or the cheapest size. */
const priceOf = (p: AdminProduct) => Number(p.has_variants && p.price_min != null ? p.price_min : p.calculated_selling_price ?? p.selling_price ?? 0);

type BulkAction = { label: string; change: { is_active?: boolean; is_available?: boolean }; destructive: boolean; note: string };
const BULK_ACTIONS: BulkAction[] = [
  { label: 'Disable', change: { is_active: false }, destructive: true, note: 'will be hidden from the customer app' },
  { label: 'Enable', change: { is_active: true }, destructive: false, note: 'will appear in the customer app again' },
  { label: 'Make unavailable', change: { is_available: false }, destructive: true, note: 'will show greyed out and cannot be ordered' },
  { label: 'Make available', change: { is_available: true }, destructive: false, note: 'can be ordered again' },
];

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
  const [priceFilter, setPriceFilter] = useState<PriceFilter>('all');
  // Bulk select (owner, 2026-10-23): tick products, then switch them all at once.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingBulk, setPendingBulk] = useState<BulkAction | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(true);
  const [pendingToggle, setPendingToggle] = useState<AdminProduct | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminProduct | null>(null);
  // Remove all product images (owner, 2026-10-14): destructive, ADMIN only.
  const isAdmin = useSignedInUser()?.role === 'ADMIN';
  const [removingImages, setRemovingImages] = useState(false);
  const [removingAll, setRemovingAll] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Every page, not just the first 200 (the API pages its product list).
      const data = await productsApi.listAllAdmin({
        search: search.trim() || undefined,
        category_id: categoryId || undefined,
        is_active: status === 'all' ? undefined : status === 'active',
      });
      setRows(data.products);
      setComplete(data.complete);
    } catch (err) {
      setError(errorMessage(err, 'Could not load products.'));
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

  const shown = useMemo(() => (rows ?? []).filter((p) => priceFilter === 'all' || priceOf(p) <= 1), [rows, priceFilter]);
  const shownIds = shown.map((p) => p.id);
  const chosen = shownIds.filter((id) => selected.has(id));
  const allChosen = shownIds.length > 0 && chosen.length === shownIds.length;
  const toggleOne = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(shownIds));

  async function runBulk(action: BulkAction) {
    setPendingBulk(null);
    setBulkBusy(true);
    try {
      const r = await productsApi.bulkStatus(chosen, action.change);
      toast.success(r.changed === 0 ? 'Nothing changed: they were already like that.' : `${action.label}: ${r.changed} ${r.changed === 1 ? 'product' : 'products'} updated.`);
      setSelected(new Set());
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the selected products.'));
    } finally {
      setBulkBusy(false);
    }
  }

  async function toggleActive(product: AdminProduct) {
    try {
      await productsApi.update(product.id, { is_active: !product.is_active });
      toast.success(
        `${product.name} is now ${product.is_active ? 'inactive' : 'active'}.`
      );
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not update the product.'));
    } finally {
      setPendingToggle(null);
    }
  }

  async function deleteProduct(product: AdminProduct) {
    setPendingDelete(null);
    try {
      const result = await productsApi.remove(product.id);
      toast.success(
        result.mode === 'SOFT'
          ? `${product.name} is deleted. Its past orders keep their history.`
          : `${product.name} is deleted.`
      );
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the product.'));
    }
    await load();
  }

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything in the catalog, including products hidden from customers."
        actions={
          <>
            {isAdmin ? (
              <>
                <button type="button" className="button button--ghost" onClick={() => setRemovingImages(true)}>
                  Remove all product images
                </button>
                <button type="button" className="button button--ghost button--danger-ghost" onClick={() => setRemovingAll(true)}>
                  Remove all products
                </button>
              </>
            ) : null}
            <button type="button" className="button button--ghost" onClick={() => navigate('/products/import')}>
              Bulk upload (Excel)
            </button>
            <button type="button" className="button" onClick={() => navigate('/products/new')}>
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
        <select
          className="input"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categoryOptions(categories).map(({ category, label }) => (
            <option key={category.id} value={category.id}>
              {label}
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
        <select
          className="input"
          value={priceFilter}
          onChange={(event) => setPriceFilter(event.target.value as PriceFilter)}
          aria-label="Filter by price"
        >
          <option value="all">Any price</option>
          <option value="placeholder">LKR 1 or less (placeholder)</option>
        </select>
      </div>

      {chosen.length > 0 ? (
        <div className="bulk-bar" role="region" aria-label="Bulk actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '8px 0' }}>
          <strong>{chosen.length} selected</strong>
          {BULK_ACTIONS.map((a) => (
            <button key={a.label} type="button" className="button button--ghost button--sm" disabled={bulkBusy} onClick={() => setPendingBulk(a)}>
              {a.label}
            </button>
          ))}
          <button type="button" className="button button--ghost button--sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      ) : null}

      {error ? <p className="field__error">{error}</p> : null}
      {rows && !complete ? (
        <p className="form__note" role="status">
          Showing the first {rows.length} products. Refine the search or filters to find the rest.
        </p>
      ) : null}

      {rows === null ? (
        <Spinner label="Loading products" />
      ) : shown.length === 0 ? (
        <EmptyState
          title="No products match"
          message="Try a different search or filter."
        />
      ) : (
        <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">
                <input type="checkbox" aria-label="Select all shown products" checked={allChosen} onChange={toggleAll} />
              </th>
              <th scope="col">Image</th>
              <th scope="col">Product</th>
              <th scope="col">Category</th>
              <th scope="col" className="num">Selling price</th>
              <th scope="col" className="num">MRP</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((product) => (
              <tr key={product.id}>
                <td>
                  <input type="checkbox" aria-label={`Select ${product.name}`} checked={selected.has(product.id)} onChange={() => toggleOne(product.id)} />
                </td>
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
                  {/* Variants, stock and lead time (migration 045). */}
                  {product.has_variants || product.stock?.tracked || (product.delivery_lead_days ?? 0) > 0 ? (
                    <span className="pv-chips">
                      {product.has_variants ? (
                        <span className="pv-chip">
                          {product.variant_count ?? 0} {(product.variant_count ?? 0) === 1 ? 'variant' : 'variants'}
                        </span>
                      ) : null}
                      {!product.has_variants ? <StockChip stock={product.stock} /> : null}
                      {(product.delivery_lead_days ?? 0) > 0 ? (
                        <span className="pv-chip pv-chip--lead" title="Delivery lead time">
                          Delivery {leadTimeText(product.delivery_lead_days)}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </td>
                <td>{product.category_name ?? categoryName(product.category_id)}</td>
                <td className="num">
                  {product.has_variants && product.price_min != null && product.price_max != null ? (
                    // A product with variants: the range of its variants' prices.
                    <span className="cell__primary">{formatPriceRange(Number(product.price_min), Number(product.price_max))}</span>
                  ) : (
                    <>LKR {Number(product.calculated_selling_price ?? product.selling_price ?? 0).toFixed(2)}</>
                  )}
                  {/* How the price is set (migration 044; owner, 2026-10-13). */}
                  {product.pricing_source && !product.has_variants ? (
                    <span className="price-source" title={pricingTitle(product)}>
                      <Badge tone="muted">{PRICING_SOURCE_LABEL[product.pricing_source] ?? product.pricing_source}</Badge>
                    </span>
                  ) : null}
                  {product.price_warning ? (
                    <span className="cell__secondary field__error">Below cost</span>
                  ) : null}
                  {/* MRP (migration 048): the selling price is the MRP. */}
                  {product.mrp_capped && product.computed_selling_price != null && !product.has_variants ? (
                    <span className="cell__secondary mrp-capped">
                      {mrpCappedNote(product.pricing_mode, Number(product.computed_selling_price))}
                    </span>
                  ) : null}
                  {/* Offer price, while it applies (owner, 2026-10-09). */}
                  {product.offer_active && product.offer_price != null ? (
                    <span className="cell__secondary">
                      <Badge tone="offer">Offer {formatMoney(product.offer_price)}</Badge>
                    </span>
                  ) : null}
                </td>
                <td className="num">
                  {product.has_variants ? (
                    <span className="cell__secondary">Per size</span>
                  ) : product.mrp != null ? (
                    formatLkr(Number(product.mrp))
                  ) : (
                    <span className="cell__secondary">-</span>
                  )}
                </td>
                <td>
                  <Badge tone={product.is_active ? 'active' : 'inactive'}>
                    {product.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                  {!product.is_available ? (
                    <Badge tone="muted">Unavailable</Badge>
                  ) : null}
                </td>
                <td>
                  <span className="cell__secondary">
                    {product.updated_at ? new Date(product.updated_at).toLocaleDateString() : '-'}
                  </span>
                </td>
                <td>
                  <div className="row-actions row-actions--wrap">
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
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => setPendingDelete(product)}
                      aria-label={`Delete ${product.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {pendingBulk ? (
        <ConfirmDialog
          title={`${pendingBulk.label}: ${chosen.length} ${chosen.length === 1 ? 'product' : 'products'}`}
          message={`The ${chosen.length} selected ${chosen.length === 1 ? 'product' : 'products'} ${pendingBulk.note}.`}
          confirmLabel={pendingBulk.label}
          destructive={pendingBulk.destructive}
          onConfirm={() => void runBulk(pendingBulk)}
          onCancel={() => setPendingBulk(null)}
        />
      ) : null}

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
      {removingImages ? (
        <RemoveProductImagesDialog onClose={() => setRemovingImages(false)} onDone={() => load()} />
      ) : null}
      {removingAll ? <RemoveAllProductsDialog onClose={() => setRemovingAll(false)} onDone={() => load()} /> : null}
    </>
  );
}

/** "Markup 25%" / "Fixed, 10% over cost": the badge's tooltip. */
function pricingTitle(product: AdminProduct): string {
  const m = product.effective_markup_percent;
  if (m === null || m === undefined) return product.pricing_mode === 'FIXED' ? 'Fixed price' : 'Markup';
  return product.pricing_mode === 'FIXED' ? `Fixed price, ${formatPercent(m)}% over cost` : `Markup ${formatPercent(m)}%`;
}
